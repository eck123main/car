import { ClientDriver, GameScreen, HostDriver, PracticeDriver, type GameDriver } from './app/game';
import { TimeTrialDriver } from './app/timeTrial';
import { OpenRoadScreen } from './app/openRoad';
import { OPEN_ROAD_MAPS } from './sim/openRoad/biomes';
import { showGarage } from './app/garage';
import { equippedSkin } from './net/wallet';
import { boardKey, isCarClassId, type CarClassId } from './sim/carClass';
import { clearUi, markTrackDriven, showLobby, showMessage, showPauseMenu, showResults, showOpenRoadMenu, showPracticeMenu, showTimeTrialMenu, showTyrePicker, showWelcome, updateLobbyNet } from './app/ui';
import { leaderboard } from './net/leaderboard';
import { accounts } from './net/accounts';
import { gameAudio } from './audio/sound';
import type { GameMode } from './sim/session';
import { recommendedStartTyre } from './sim/strategy';
import { Keyboard, Mouse } from './game/input';
import { ClientGame } from './net/client';
import { HostGame } from './net/host';
import { connectToHost, createHost } from './net/peer';
import { OfflineTransport } from './net/transport';
import { adjustAllStoredTimes } from './net/adjustTimes';
import { Track } from './track/track';
import type { TrackDef } from './track/types';
import { DEFAULT_TRACK, loadCustomTrack, trackChoices, TRACKS } from './tracks';

// Times kept in this browser follow physics changes (elevation, the ground fix), each once.
try {
  adjustAllStoredTimes(localStorage, Object.keys(localStorage));
} catch {
  // Storage blocked: nothing kept to adjust.
}

const canvas = document.getElementById('game') as HTMLCanvasElement;
const keyboard = new Keyboard(window);
const mouse = new Mouse(canvas, window);
const params = new URLSearchParams(location.search);
const joinCode = params.get('join');

let game: GameScreen | null = null;
let road: OpenRoadScreen | null = null;
let cleanup: () => void = () => {};

function trackDef(id: string): TrackDef | undefined {
  return id === 'custom' ? (loadCustomTrack() ?? undefined) : TRACKS[id];
}

function trackList(): { id: string; name: string }[] {
  const list = trackChoices();
  const custom = loadCustomTrack();
  if (custom) list.push({ id: 'custom', name: `${custom.name} (from editor)` });
  return list;
}

/** A results screen's "Watch last lap": the screen goes, and comes back when the replay ends. */
function replayOffer(back: () => void): (() => void) | undefined {
  if (!game?.canReplay()) return undefined;
  return () => {
    clearUi();
    game?.startReplay(back);
  };
}

/** A results screen's "Best moment", if the race had one. */
function momentOffer(back: () => void): (() => void) | undefined {
  if (!game?.hasMoment()) return undefined;
  return () => {
    clearUi();
    game?.startMoment(back);
  };
}

function stopGame(): void {
  game?.stop();
  game = null;
  road?.stop();
  road = null;
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

/** Back to the start screen, dropping any lobby or connection. */
function home(): void {
  cleanup();
  cleanup = () => {};
  stopGame();
  // Forget the invite once we've left that lobby.
  if (joinCode) history.replaceState(null, '', location.pathname);
  welcome(false);
}

function welcome(joining: boolean): void {
  showWelcome({
    joining,
    onJoin: join,
    onHost: (n) => host(n, false),
    onBots: (n) => host(n, true),
    onParty: (n) => host(n, true, 'party'),
    onPractice: practice,
    onOpenRoad: openRoad,
    onTimeTrial: timeTrial,
    onGarage: garage,
    board: leaderboard(),
    accounts: accounts(),
    onBack: () => welcome(joining),
  });
}

/** Real circuits only (not the test track or the editor's custom one): medals and fair times. */
function realTracks(): { id: string; name: string }[] {
  return trackList().filter((t) => t.id !== 'custom' && t.id !== 'test');
}

function garage(): void {
  showGarage({ accounts: accounts(), board: leaderboard(), tracks: realTracks(), onBack: home });
}

function runGame(
  driver: GameDriver,
  opts: {
    onFinished?: () => void;
    menuNote: string;
    onLeave?: () => void;
    leaveLabel?: string;
    /** An extra menu button; the menu closes and the game resumes after it. */
    extra?: { label: string; onClick: () => void };
  },
): void {
  stopGame();
  clearUi();
  game = new GameScreen(canvas, keyboard, driver, mouse);
  // Dev server only: the game is reachable from the browser console, for testing.
  if (import.meta.env.DEV) (window as unknown as { f1game: GameScreen }).f1game = game;
  const g = game;
  g.onMenu = () => {
    g.setPaused(true);
    showPauseMenu(
      () => {
        g.setPaused(false);
        clearUi();
      },
      opts.onLeave ?? home,
      opts.menuNote,
      opts.leaveLabel,
      opts.extra && {
        label: opts.extra.label,
        onClick: () => {
          opts.extra!.onClick();
          g.setPaused(false);
          clearUi();
        },
      },
    );
  };
  let closePicker: (() => void) | null = null;
  g.onPhase = (phase) => {
    closePicker?.();
    closePicker = null;
    if (phase === 'finished') opts.onFinished?.();
    // A new session started (play again): take the results screen away.
    else if (phase === 'qualifying' || phase === 'grid') clearUi();
    if (phase === 'grid') closePicker = openTyrePicker(g, driver);
    else g.controls.ready = false;
  };
  g.start();
}

/** Starting tyre choice while the cars sit on the grid. */
function openTyrePicker(g: GameScreen, driver: GameDriver): () => void {
  g.controls.ready = false;
  return showTyrePicker(
    () => {
      const s = driver.session();
      const world = driver.world();
      const wet = world?.options.wetness ?? 0;
      const waitingFor = (world?.racers ?? []).filter((r) => !s?.ready.includes(r.id)).map((r) => r.name);
      return {
        selected: g.controls.nextTyre,
        ready: s?.ready.includes(driver.meId) ?? false,
        endsIn: (s?.gridEndsAt ?? 0) - driver.now(),
        recommended: recommendedStartTyre(wet, s?.laps ?? 5, s?.mandatoryStop ?? false, s?.tyreWear ?? true),
        laps: s?.laps ?? 5,
        tyreWear: s?.tyreWear ?? true,
        note: s?.mandatoryStop
          ? 'Dry race: you must also use a second dry compound at your pit stop.'
          : 'Pick the tyres you start the race on.',
        waitingFor,
      };
    },
    (c) => (g.controls.nextTyre = c),
    () => (g.controls.ready = true),
  );
}

// ---------- The car, for everything but time trial (which remembers its own)

const CLASS_KEY = 'f1td.class';

function savedClass(): CarClassId {
  try {
    const saved = localStorage.getItem(CLASS_KEY);
    if (isCarClassId(saved)) return saved;
  } catch {
    // Remembering it is a convenience only.
  }
  return 'f1';
}

function saveClass(cls: CarClassId): void {
  try {
    localStorage.setItem(CLASS_KEY, cls);
  } catch {
    // Remembering it is a convenience only.
  }
}

// ---------- Practice

function practice(name: string): void {
  stopGame();
  showPracticeMenu(savedClass(), (cls) => drivePractice(name, cls), home);
}

function drivePractice(name: string, cls: CarClassId): void {
  saveClass(cls);
  const id = params.get('track') ?? DEFAULT_TRACK;
  const def = trackDef(id) ?? TRACKS[DEFAULT_TRACK];
  const driver = new PracticeDriver(new Track(def), name, cls);
  driver.world().racers[0].skin = equippedSkin();
  runGame(driver, { menuNote: 'Practice: R puts you back on track.' });
}

// ---------- Open road

function openRoad(): void {
  stopGame();
  showOpenRoadMenu(
    OPEN_ROAD_MAPS,
    savedClass(),
    (cls) => {
      saveClass(cls);
      openRoad();
    },
    driveOpenRoad,
    home,
  );
}

/** A new road every time. */
function driveOpenRoad(mapId: string): void {
  stopGame();
  clearUi();
  const screen = new OpenRoadScreen(canvas, keyboard, mouse, mapId, Math.floor(Math.random() * 2 ** 31), equippedSkin(), savedClass());
  road = screen;
  screen.onMenu = () => {
    screen.setPaused(true);
    showPauseMenu(
      () => {
        screen.setPaused(false);
        clearUi();
      },
      openRoad,
      'Paused. F autopilot, C camera, T time of day, N music, H hide the display, R back on the road.',
      'Change scenery',
      { label: 'New road', onClick: () => driveOpenRoad(mapId) },
    );
  };
  screen.start();
}

// ---------- Time trial

const TT_TRACK_KEY = 'f1td.tt.track';
const TT_CLASS_KEY = 'f1td.tt.class';

function timeTrial(name: string, track?: string, carClass?: CarClassId): void {
  let last = DEFAULT_TRACK;
  let cls: CarClassId = 'f1';
  try {
    last = track ?? localStorage.getItem(TT_TRACK_KEY) ?? DEFAULT_TRACK;
    const saved = carClass ?? localStorage.getItem(TT_CLASS_KEY);
    if (isCarClassId(saved)) cls = saved;
    localStorage.setItem(TT_CLASS_KEY, cls);
  } catch {
    // Default track and car then.
  }
  stopGame();
  showTimeTrialMenu({
    // Only the real circuits (and not the editor's custom track): times must be comparable.
    tracks: realTracks(),
    track: TRACKS[last] ? last : DEFAULT_TRACK,
    carClass: cls,
    onClass: (c, t) => timeTrial(name, t, c),
    board: leaderboard(),
    signedIn: leaderboard().global && !!accounts()?.account(),
    onBack: home,
    onDrive: (id, ghost) => {
      try {
        localStorage.setItem(TT_TRACK_KEY, id);
      } catch {
        // Remembering the track is a convenience only.
      }
      const key = boardKey(id, cls);
      markTrackDriven(key);
      const driver = new TimeTrialDriver(new Track(TRACKS[id]), key, name, leaderboard(), ghost);
      driver.tt.me.skin = equippedSkin();
      runGame(driver, {
        menuNote: 'Time trial (paused). R or ENTER restarts the lap, G switches the ghost.',
        onLeave: () => timeTrial(name, id, cls),
        leaveLabel: 'Change track',
        extra: { label: 'Restart lap', onClick: () => (driver.restartRequested = true) },
      });
    },
  });
}

// ---------- Hosting

/** Host a lobby. Offline: nobody can join (racing bots on your own, no internet needed). */
async function host(name: string, offline: boolean, mode: GameMode = 'classic'): Promise<void> {
  if (!offline) showMessage('Creating lobby…', 'Connecting to the matchmaking server.');
  let hostGame: HostGame;
  try {
    const transport = offline ? new OfflineTransport() : await createHost();
    hostGame = new HostGame(transport, name, trackDef, undefined, equippedSkin());
    hostGame.updateSettings({ mode, carClass: savedClass() });
    // A bots race starts with a few opponents ready to go.
    if (offline) for (const d of ['hard', 'medium', 'medium', 'easy', 'easy'] as const) hostGame.addBot(d);
    // Dev server only: the race is reachable from the browser console, for testing.
    if (import.meta.env.DEV) (window as unknown as { f1host: HostGame }).f1host = hostGame;
  } catch (err) {
    showMessage("Couldn't create a lobby", (err as Error).message, { label: 'Back', onClick: home });
    return;
  }
  // Pings to everyone who joined, for the lobby (the race pings from its own loop too).
  const pinger = offline ? null : setInterval(() => hostGame.tickNet(), 250);
  hostGame.onNetChange = updateLobbyNet;
  cleanup = () => {
    if (pinger !== null) clearInterval(pinger);
    hostGame.close();
  };
  const invite = offline ? '' : `${location.origin}${location.pathname}?join=${hostGame.transport.code}`;
  const showResultsForHost = () => {
    const s = hostGame.session!;
    showResults({
      standings: s.standings(),
      world: s.world,
      meId: HostGame.HOST_ID,
      isHost: true,
      onReplay: replayOffer(showResultsForHost),
      onMoment: momentOffer(showResultsForHost),
      onContinue: () => {
        stopGame();
        hostGame.backToLobby();
      },
      onPlayAgain: () => {
        hostGame.start();
        clearUi();
      },
      onLeave: home,
    });
  };
  const lobby = () => {
    if (hostGame.session) return;
    showLobby({
      lobby: hostGame.lobby,
      meId: HostGame.HOST_ID,
      isHost: true,
      inviteLink: invite,
      tracks: trackList(),
      onSettings: (c) => {
        if (c.carClass) saveClass(c.carClass);
        hostGame.updateSettings(c);
      },
      onAddBot: (d) => hostGame.addBot(d),
      onRemoveBot: (id) => hostGame.removeBot(id),
      onStart: () => {
        hostGame.start();
        runGame(new HostDriver(hostGame), {
          menuNote: offline ? 'Leaving ends the race.' : 'You are the host: leaving ends the race for everyone.',
          onFinished: showResultsForHost,
        });
      },
      onLeave: home,
    });
    updateLobbyNet(hostGame.net);
  };
  hostGame.onLobbyChange = lobby;
  lobby();
}

// ---------- Joining

async function join(name: string): Promise<void> {
  showMessage('Joining…', 'Connecting to the lobby.');
  let client: ClientGame;
  try {
    const conn = await connectToHost(joinCode!);
    client = new ClientGame(conn, name, () => performance.now() / 1000, equippedSkin());
  } catch (err) {
    showMessage("Couldn't join", (err as Error).message, { label: 'Back', onClick: home });
    return;
  }
  let shown = '';
  let lobbyJson = '';
  // Watch the client and switch screens when its state changes.
  const watch = setInterval(() => {
    const status = client.status;
    if (status === 'rejected' || status === 'closed') {
      clearInterval(watch);
      stopGame();
      showMessage(
        status === 'rejected' ? "Couldn't join" : 'Disconnected',
        status === 'rejected' ? client.rejectReason : 'The host closed the lobby or the connection dropped.',
        { label: 'OK', onClick: home },
      );
      return;
    }
    if (status === 'lobby' && client.lobby) {
      const json = JSON.stringify(client.lobby);
      if (shown !== 'lobby' || json !== lobbyJson) {
        shown = 'lobby';
        lobbyJson = json;
        stopGame();
        showLobby({
          lobby: client.lobby,
          meId: client.id ?? '',
          isHost: false,
          inviteLink: location.href,
          tracks: trackList(),
          onSettings: () => {},
          onStart: () => {},
          onLeave: home,
        });
      }
      updateLobbyNet(client.net);
    } else if (status === 'racing' && shown !== 'racing') {
      shown = 'racing';
      runGame(new ClientDriver(client), {
        menuNote: 'The race keeps going while this menu is open.',
        onFinished: function results() {
          if (!client.world || !client.session) return;
          showResults({
            standings: client.session.standings,
            world: client.world,
            meId: client.id ?? '',
            isHost: false,
            onReplay: replayOffer(results),
            onMoment: momentOffer(results),
            onLeave: home,
          });
        },
      });
    }
  }, 100);
  cleanup = () => {
    clearInterval(watch);
    client.close();
  };
}

// Browsers only allow sound once the player has clicked or pressed a key.
for (const type of ['pointerdown', 'keydown'] as const) window.addEventListener(type, () => gameAudio().unlock(), { capture: true });
// A remembered sign-in may have ended (signed out elsewhere): check, and refresh the start screen.
const service = accounts();
const remembered = service?.account();
if (service && remembered) {
  void service.verify().then(() => {
    if (service.account() !== remembered && !game && document.querySelector('.account-bar')) welcome(joinCode !== null);
  });
}

welcome(joinCode !== null);
