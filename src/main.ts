import { ClientDriver, GameScreen, HostDriver, PracticeDriver, type GameDriver } from './app/game';
import { clearUi, showLobby, showMessage, showPauseMenu, showResults, showWelcome } from './app/ui';
import { Keyboard } from './game/input';
import { ClientGame } from './net/client';
import { HostGame } from './net/host';
import { connectToHost, createHost } from './net/peer';
import { Track } from './track/track';
import type { TrackDef } from './track/types';
import { DEFAULT_TRACK, loadCustomTrack, TRACKS } from './tracks';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const keyboard = new Keyboard(window);
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
  showWelcome({ joining, onJoin: join, onHost: host, onPractice: practice });
}

function runGame(driver: GameDriver, opts: { onFinished?: () => void; menuNote: string }): void {
  stopGame();
  clearUi();
  game = new GameScreen(canvas, keyboard, driver);
  const g = game;
  g.onMenu = () => {
    g.setPaused(true);
    showPauseMenu(
      () => {
        g.setPaused(false);
        clearUi();
      },
      home,
      opts.menuNote,
    );
  };
  g.onPhase = (phase) => {
    if (phase === 'finished') opts.onFinished?.();
  };
  g.start();
}

// ---------- Practice

function practice(name: string): void {
  const id = params.get('track') ?? DEFAULT_TRACK;
  const def = trackDef(id) ?? TRACKS[DEFAULT_TRACK];
  runGame(new PracticeDriver(new Track(def), name), { menuNote: 'Practice: R puts you back on track.' });
}

// ---------- Hosting

async function host(name: string): Promise<void> {
  showMessage('Creating lobby…', 'Connecting to the matchmaking server.');
  let hostGame: HostGame;
  try {
    const transport = await createHost();
    hostGame = new HostGame(transport, name, trackDef);
  } catch (err) {
    showMessage("Couldn't create a lobby", (err as Error).message, { label: 'Back', onClick: home });
    return;
  }
  cleanup = () => hostGame.close();
  const invite = `${location.origin}${location.pathname}?join=${hostGame.transport.code}`;
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
      onStart: () => {
        hostGame.start();
        runGame(new HostDriver(hostGame), {
          menuNote: 'You are the host: leaving ends the race for everyone.',
          onFinished: showResultsForHost,
        });
      },
      onLeave: home,
    });
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

welcome(joinCode !== null);
