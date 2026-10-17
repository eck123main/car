import { ClientDriver, GameScreen, HostDriver, PracticeDriver, type GameDriver } from './app/game';
import { TimeTrialDriver } from './app/timeTrial';
import { clearUi, showLobby, showMessage, showPauseMenu, showResults, showTimeTrialMenu, showTyrePicker, showWelcome, updateLobbyNet } from './app/ui';
import { leaderboard } from './net/leaderboard';
import { accounts } from './net/accounts';
import { gameAudio } from './audio/sound';
import { recommendedStartTyre } from './sim/strategy';
import { Keyboard, Mouse } from './game/input';
import { ClientGame } from './net/client';
import { HostGame } from './net/host';
import { connectToHost, createHost } from './net/peer';
import { OfflineTransport } from './net/transport';
import { Track } from './track/track';
import type { TrackDef } from './track/types';
import { DEFAULT_TRACK, loadCustomTrack, TRACKS } from './tracks';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const keyboard = new Keyboard(window);
const mouse = new Mouse(canvas, window);
const params = new URLSearchParams(location.search);
const joinCode = params.get('join');

let game: GameScreen | null = null;
let cleanup: () => void = () => {};

function trackDef(id: string): TrackDef | undefined {
  return id === 'custom' ? (loadCustomTrack() ?? undefined) : TRACKS[id];
}

function trackList(): { id: string; name: string }[] {
  const list = Object.entries(TRACKS).map(([id, t]) => ({ id, name: t.name }));
  const custom = loadCustomTrack();
  if (custom) list.push({ id: 'custom', name: `${custom.name} (from editor)` });
  return list;
}

function stopGame(): void {
  game?.stop();
  game = null;
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
    onPractice: practice,
    onTimeTrial: timeTrial,
    accounts: accounts(),
    onBack: () => welcome(joining),
  });
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
        recommended: recommendedStartTyre(wet, s?.laps ?? 5, s?.mandatoryStop ?? false),
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

// ---------- Practice

function practice(name: string): void {
  const id = params.get('track') ?? DEFAULT_TRACK;
  const def = trackDef(id) ?? TRACKS[DEFAULT_TRACK];
  runGame(new PracticeDriver(new Track(def), name), { menuNote: 'Practice: R puts you back on track.' });
}

// ---------- Time trial

const TT_TRACK_KEY = 'f1td.tt.track';

function timeTrial(name: string): void {
  let last = DEFAULT_TRACK;
  try {
    last = localStorage.getItem(TT_TRACK_KEY) ?? DEFAULT_TRACK;
  } catch {
    // Default track then.
  }
  stopGame();
  showTimeTrialMenu({
    // Only the real circuits (and not the editor's custom track): times must be comparable.
    tracks: trackList().filter((t) => t.id !== 'custom' && t.id !== 'test'),
    track: TRACKS[last] ? last : DEFAULT_TRACK,
    board: leaderboard(),
    onBack: home,
    onDrive: (id, ghost) => {
      try {
        localStorage.setItem(TT_TRACK_KEY, id);
      } catch {
        // Remembering the track is a convenience only.
      }
      const driver = new TimeTrialDriver(new Track(TRACKS[id]), id, name, leaderboard(), ghost);
      runGame(driver, {
        menuNote: 'Time trial (paused). R or ENTER restarts the lap, G switches the ghost.',
        onLeave: () => timeTrial(name),
        leaveLabel: 'Change track',
        extra: { label: 'Restart lap', onClick: () => (driver.restartRequested = true) },
      });
    },
  });
}

// ---------- Hosting

/** Host a lobby. Offline: nobody can join (racing bots on your own, no internet needed). */
async function host(name: string, offline: boolean): Promise<void> {
  if (!offline) showMessage('Creating lobby…', 'Connecting to the matchmaking server.');
  let hostGame: HostGame;
  try {
    const transport = offline ? new OfflineTransport() : await createHost();
    hostGame = new HostGame(transport, name, trackDef);
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
      onSettings: (c) => hostGame.updateSettings(c),
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
    client = new ClientGame(conn, name, () => performance.now() / 1000);
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
        onFinished: () => {
          if (!client.world || !client.session) return;
          showResults({
            standings: client.session.standings,
            world: client.world,
            meId: client.id ?? '',
            isHost: false,
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
