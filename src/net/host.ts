import { botContext, BotDriver, type Difficulty } from '../sim/ai/botDriver';
import { DEFAULT_SETTINGS, Session, type PlayerInfo, type RaceSettings, type SessionEvent } from '../sim/session';
import { IDLE_INPUT, type PlayerInput } from '../sim/world';
import { Track } from '../track/track';
import type { TrackDef } from '../track/types';
import { MAX_PLAYERS, PROTOCOL_VERSION, type ClientMessage, type HostMessage, type LobbyPlayer, type LobbyState, type NetInfo } from './protocol';
import { carSnap, sessionSnap, timingSnap, unpackInput } from './snapshot';
import type { Connection, HostTransport } from './transport';

/** Distinct car colours, handed out in order. */
export const CAR_COLORS = [
  '#e10600', '#1e5bff', '#ff8700', '#00d2be', '#f596c8',
  '#52e252', '#ffd400', '#b06cff', '#e8e8e8', '#8b5a2b',
];

/** Names for computer drivers (made up, not real drivers). */
const BOT_NAMES = [
  'Max Throttle', 'Lewis Late-Brake', 'Kimi Kerb', 'Fernando Flatout', 'Sebastian Slipstream',
  'Lando Apex', 'Charles Chicane', 'Oscar Overtake', 'George Gravel', 'Nico Notch',
];

/** Physics steps between snapshots (20 Hz) and between timing/standings updates (4 Hz). */
const SNAP_EVERY = 6;
const STATE_EVERY = 30;
/** Inputs buffered per remote player; more than this means they're ahead, so drop old ones. */
const MAX_QUEUED_INPUTS = 8;
/**
 * Inputs kept waiting to smooth over network jitter. When the queue never got shorter than
 * this over a QUEUE_WINDOW of steps, it's a backlog (each queued input is 8 ms more delay for
 * that player's car), so one input is dropped to drain it gently.
 */
const QUEUE_TARGET = 2;
const QUEUE_WINDOW = 60;

interface Remote {
  conn: Connection;
  player: LobbyPlayer;
  queue: { seq: number; input: PlayerInput }[];
  last: PlayerInput;
  ack: number;
  /** Highest input number received: inputs come more than once (in case one is lost). */
  received: number;
  /** Shortest the input queue got during the current window of steps. */
  minQueue: number;
  window: number;
  /** Smoothed round-trip time (ms), and whether the link goes through a relay server. */
  ping: number | null;
  relayed: boolean | null;
  /** The last ping sent: its number and when (host clock, s). */
  pingSent: { n: number; at: number } | null;
}

/** New round-trip times are blended in with this weight, so the number doesn't jump about. */
const PING_SMOOTHING = 0.4;
/** Seconds between pings. */
const PING_INTERVAL = 1;

/**
 * The lobby owner's game: runs the lobby and the authoritative race, and keeps every
 * client up to date. The host also plays, with id HOST_ID.
 */
export class HostGame {
  static readonly HOST_ID = 'host';
  settings: RaceSettings = { ...DEFAULT_SETTINGS };
  session: Session | null = null;
  track: Track | null = null;
  /** The running weekend's track and drivers, for anyone who joins late to spectate. */
  private running: { def: TrackDef; players: PlayerInfo[] } | null = null;
  private readonly hostPlayer: LobbyPlayer;
  private readonly remotes = new Map<string, Remote>();
  /** Computer drivers in the lobby, and their brains once a race starts. */
  private readonly bots = new Map<string, { player: LobbyPlayer; driver: BotDriver | null }>();
  private nextBot = 1;
  private nextId = 1;
  private steps = 0;
  private localEvents: SessionEvent[] = [];
  private pings = 0;
  private lastPingAt = -Infinity;
  /** Called whenever the lobby changes (for the host's own lobby screen). */
  onLobbyChange: (lobby: LobbyState) => void = () => {};
  /** Called when pings have been updated (about once a second). */
  onNetChange: (net: NetInfo[]) => void = () => {};

  constructor(
    readonly transport: HostTransport,
    hostName: string,
    private readonly trackDefs: (id: string) => TrackDef | undefined,
    /** Wall-clock seconds, for measuring pings. */
    private readonly clock: () => number = () => performance.now() / 1000,
  ) {
    this.hostPlayer = { id: HostGame.HOST_ID, name: hostName, color: CAR_COLORS[0], host: true };
    transport.onConnection((conn) => this.accept(conn));
  }

  get lobby(): LobbyState {
    return {
      players: [this.hostPlayer, ...[...this.remotes.values()].map((r) => r.player), ...[...this.bots.values()].map((b) => b.player)],
      settings: this.settings,
    };
  }

  /** Every player's connection to us. The host and bots have none (null). */
  get net(): NetInfo[] {
    return this.lobby.players.map((p) => {
      const r = this.remotes.get(p.id);
      return { id: p.id, ping: r?.ping ?? null, relayed: r?.relayed ?? null };
    });
  }

  /**
   * Once a second: ping every player and share the results. The race calls this every step;
   * call it from a timer too, for the lobby. The previous round's answers are in by now, and
   * route lookups finish in the background.
   */
  tickNet(): void {
    const at = this.clock();
    if (at - this.lastPingAt < PING_INTERVAL) return;
    this.lastPingAt = at;
    const n = ++this.pings;
    for (const r of this.remotes.values()) {
      r.pingSent = { n, at };
      r.conn.sendFast({ t: 'ping', n } satisfies HostMessage);
      r.conn.route?.().then((route) => {
        if (route) r.relayed = route === 'relayed';
      });
    }
    const net = this.net;
    this.broadcast({ t: 'net', net });
    this.onNetChange(net);
  }

  updateSettings(changes: Partial<RaceSettings>): void {
    this.settings = { ...this.settings, ...changes };
    this.lobbyChanged();
  }

  /** Add a computer driver to the lobby. Returns false if the lobby is full. */
  addBot(difficulty: Difficulty): boolean {
    const players = this.lobby.players;
    if (players.length >= MAX_PLAYERS || this.session) return false;
    const id = `bot${this.nextBot++}`;
    const used = new Set(players.map((p) => p.color));
    const color = CAR_COLORS.find((c) => !used.has(c)) ?? CAR_COLORS[0];
    const names = new Set(players.map((p) => p.name));
    const name = BOT_NAMES.find((n) => !names.has(n)) ?? `Bot ${this.nextBot - 1}`;
    this.bots.set(id, { player: { id, name, color, host: false, bot: difficulty }, driver: null });
    this.lobbyChanged();
    return true;
  }

  removeBot(id: string): void {
    if (this.session || !this.bots.delete(id)) return;
    this.lobbyChanged();
  }

  start(): void {
    const def = this.trackDefs(this.settings.trackId);
    if (!def) throw new Error(`Unknown track ${this.settings.trackId}`);
    this.track = new Track(def);
    const players = this.lobby.players.map(({ id, name, color }) => ({ id, name, color }));
    this.session = new Session(this.track, this.settings, players);
    this.running = { def, players };
    for (const b of this.bots.values()) b.driver = new BotDriver(this.track, b.player.id, b.player.bot!);
    this.steps = 0;
    for (const r of this.remotes.values()) {
      r.queue = [];
      r.minQueue = Infinity;
      r.window = 0;
      r.last = IDLE_INPUT;
      r.ack = 0;
    }
    this.broadcast({ t: 'start', track: def, settings: this.settings, players });
    this.sendState();
  }

  backToLobby(): void {
    this.session = null;
    this.running = null;
    this.track = null;
    this.lobbyChanged();
  }

  /** One physics step of the race. */
  step(dt: number, localInput: PlayerInput): void {
    const session = this.session;
    if (!session) return;
    const inputs = new Map<string, PlayerInput>([[HostGame.HOST_ID, localInput]]);
    for (const [id, r] of this.remotes) {
      r.minQueue = Math.min(r.minQueue, r.queue.length);
      if (++r.window >= QUEUE_WINDOW) {
        if (r.minQueue > QUEUE_TARGET) dropOldest(r.queue);
        r.minQueue = Infinity;
        r.window = 0;
      }
      const next = r.queue.shift();
      if (next) {
        r.last = next.input;
        r.ack = next.seq;
      }
      inputs.set(id, r.last);
    }
    const ctx = botContext(session);
    for (const [id, b] of this.bots) if (b.driver) inputs.set(id, b.driver.drive(session.world, ctx, dt));
    const events = session.step(dt, inputs);
    this.steps++;
    this.tickNet();
    if (events.length) {
      this.localEvents.push(...events);
      this.broadcast({ t: 'events', time: session.world.time, events });
    }
    if (this.steps % SNAP_EVERY === 0) {
      const cars = session.world.racers.map((r) => carSnap(r, this.remotes.get(r.id)?.ack ?? 0));
      this.broadcast({ t: 'snap', time: session.world.time, cars, sc: session.safetyCar?.snap() }, true);
    }
    if (this.steps % STATE_EVERY === 0 || events.some((e) => e.kind === 'phase')) this.sendState();
  }

  /** Events since the last call, for the host's own HUD. */
  takeEvents(): SessionEvent[] {
    const out = this.localEvents;
    this.localEvents = [];
    return out;
  }

  close(): void {
    for (const r of this.remotes.values()) r.conn.close();
    this.transport.close();
  }

  private accept(conn: Connection): void {
    let joined: Remote | null = null;
    conn.onMessage((raw) => {
      const msg = raw as ClientMessage;
      if (!joined) {
        if (msg.t !== 'hello') return;
        const reason =
          msg.version !== PROTOCOL_VERSION
            ? 'Different game version: refresh the page'
            : this.lobby.players.length >= MAX_PLAYERS
                ? 'The lobby is full'
                : null;
        if (reason) {
          conn.send({ t: 'reject', reason } satisfies HostMessage);
          return;
        }
        const id = `p${this.nextId++}`;
        const used = new Set(this.lobby.players.map((p) => p.color));
        const color = CAR_COLORS.find((c) => !used.has(c)) ?? CAR_COLORS[0];
        const name = (typeof msg.name === 'string' ? msg.name : '').trim().slice(0, 16) || `Driver ${this.nextId - 1}`;
        joined = { conn, player: { id, name, color, host: false }, queue: [], last: IDLE_INPUT, ack: 0, received: 0, minQueue: Infinity, window: 0, ping: null, relayed: null, pingSent: null };
        this.remotes.set(id, joined);
        conn.send({ t: 'welcome', id } satisfies HostMessage);
        // Joining while a weekend is on: spectate it now, race in the next one.
        if (this.running) {
          conn.send({ t: 'start', track: this.running.def, settings: this.settings, players: this.running.players } satisfies HostMessage);
          this.sendState();
        }
        this.lobbyChanged();
        return;
      }
      if (msg.t === 'pong' && joined.pingSent?.n === msg.n) {
        const rtt = (this.clock() - joined.pingSent.at) * 1000;
        joined.ping = joined.ping === null ? rtt : joined.ping + (rtt - joined.ping) * PING_SMOOTHING;
        joined.pingSent = null;
      }
      if (msg.t === 'input' && Array.isArray(msg.inputs)) {
        for (const packed of msg.inputs) {
          const item = unpackInput(packed);
          if (!item || item.seq <= Math.max(joined.received, joined.ack)) continue;
          joined.received = item.seq;
          joined.queue.push(item);
        }
        while (joined.queue.length > MAX_QUEUED_INPUTS) dropOldest(joined.queue);
      }
    });
    conn.onClose(() => {
      if (!joined) return;
      this.remotes.delete(joined.player.id);
      // Leaving mid-race counts as retiring.
      const racer = this.session?.world.racer(joined.player.id);
      if (racer) racer.car.retired = true;
      this.lobbyChanged();
    });
  }

  private lobbyChanged(): void {
    const lobby = this.lobby;
    if (!this.session) this.broadcast({ t: 'lobby', lobby });
    this.onLobbyChange(lobby);
  }

  private sendState(): void {
    const session = this.session;
    if (!session) return;
    this.broadcast({
      t: 'state',
      time: session.world.time,
      session: sessionSnap(session),
      timing: session.world.racers.map((r) => timingSnap(session, r)),
    });
  }

  /** To every player; `fast` for snapshots, which are fine to lose now and then. */
  private broadcast(msg: HostMessage, fast = false): void {
    for (const r of this.remotes.values()) {
      if (fast) r.conn.sendFast(msg);
      else r.conn.send(msg);
    }
  }
}

/** Drop the oldest queued input. Key presses (R) must survive: carry them over to the next one. */
function dropOldest(queue: Remote['queue']): void {
  const dropped = queue.shift()!;
  if (dropped.input.reset && queue[0]) queue[0] = { ...queue[0], input: { ...queue[0].input, reset: true } };
}
