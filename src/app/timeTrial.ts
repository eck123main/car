import type { Keyboard } from '../game/input';
import { loadPersonalGhost, playerId, savePersonalGhost, type Leaderboard, type TimeEntry } from '../net/leaderboard';
import type { Pose } from '../net/client';
import { formatLapTime } from '../render/hud';
import { drawInvalidPrompt, drawLeaderboard, drawNotice, GHOST_COLOR } from '../render/timeTrialHud';
import { ghostDelta, ghostPose, ghostTrace, type Ghost } from '../sim/ghost';
import type { SessionEvent } from '../sim/session';
import { TimeTrial, type TimeTrialLap } from '../sim/timeTrial';
import type { PlayerInput, Racer } from '../sim/world';
import type { Track } from '../track/track';
import type { GameDriver, GhostCar } from './game';

/** The player's car in time trial (the ghost is GHOST_COLOR, so they never look alike). */
export const TIME_TRIAL_COLOR = '#e10600';
/** How long the "lap invalid" prompt stays up (s). */
const PROMPT_TIME = 6;
/**
 * Seconds of driving between leaderboard reloads. New laps are normally announced the moment
 * they're saved; this is the fallback when that live connection is blocked.
 */
const REFRESH_EVERY = 30;

/**
 * Which ghost to race: a leaderboard player's id, 'personal' (your own best), 'off', or 'auto'
 * (the fastest player who isn't you).
 */
export type GhostChoice = string;
/** G cycles through this many of the fastest other players, then your best, then off. */
const GHOST_PLAYERS = 5;

interface LoadedGhost {
  ghost: Ghost;
  trace: number[];
}

/** Time trial on one machine: alone on track against the leaderboard and a ghost. */
export class TimeTrialDriver implements GameDriver {
  readonly meId = 'me';
  readonly pausable = true;
  readonly resetHint = 'R or ENTER: restart from the start';
  readonly tt: TimeTrial;
  /** Set by the menu's Restart lap button; handled on the next step. */
  restartRequested = false;
  private events: SessionEvent[] = [];
  private restartDown = false;
  private board: TimeEntry[] = [];
  private boardState: 'loading' | 'ok' | 'error' = 'loading';
  private readonly player = playerId();
  private personal: LoadedGhost | null = null;
  /** Other players' ghosts by player id (null: loading, or they have none). */
  private readonly playerGhosts = new Map<string, LoadedGhost | null>();
  private notice: { text: string; color: string; until: number } | null = null;
  /** Our best lap time on this track (from the leaderboard or this browser). */
  private best: number | null = null;
  private lastRefresh = 0;
  private readonly unwatch: () => void;

  constructor(
    private readonly track: Track,
    private readonly trackId: string,
    name: string,
    private readonly store: Leaderboard,
    private ghostChoice: GhostChoice = 'auto',
  ) {
    this.tt = new TimeTrial(track, trackId, name, TIME_TRIAL_COLOR);
    this.tt.onLap = (lap) => this.lapDone(lap);
    const pb = loadPersonalGhost(trackId, this.player);
    if (pb) {
      this.personal = this.load(pb);
      this.best = pb.time;
    } else {
      // Signed in on another device, or a new browser: our best ghost is on the leaderboard.
      store
        .ghostOf(trackId, this.player)
        .then((g) => {
          if (!g || (this.personal && this.personal.ghost.time <= g.time)) return;
          this.personal = this.load(g);
          if (this.best === null || g.time < this.best) this.best = g.time;
        })
        .catch((err) => console.warn(err));
    }
    void this.refresh();
    this.unwatch = store.watch(trackId, () => void this.refresh());
  }

  /** Leaving the track: stop listening for other players' laps. */
  dispose(): void {
    this.unwatch();
  }

  /** Reload the leaderboard. */
  private async refresh(): Promise<void> {
    this.lastRefresh = this.tt.world.time;
    try {
      const before = this.boardState === 'ok' ? this.board[0] : undefined;
      this.board = await this.store.top(this.trackId, 50);
      this.boardState = 'ok';
      // Someone else just took the record: tell whoever is driving.
      const leader = this.board[0];
      if (before && leader && leader.player !== this.player && leader.time < before.time) {
        this.notice = { text: `NEW RECORD: ${leader.name} ${formatLapTime(leader.time)}`, color: '#b84dff', until: this.tt.world.time + 5 };
      }
      const mine = this.board.find((e) => e.player === this.player);
      if (mine && (this.best === null || mine.time < this.best)) this.best = mine.time;
      // Someone improved: their old ghost is out of date.
      for (const [id, g] of this.playerGhosts) {
        const row = this.board.find((e) => e.player === id);
        if (g && row && row.time < g.ghost.time) this.playerGhosts.delete(id);
      }
    } catch (err) {
      console.warn(err);
      this.boardState = 'error';
    }
  }

  private load(ghost: Ghost): LoadedGhost {
    return { ghost, trace: ghostTrace(ghost, this.track) };
  }

  private lapDone(lap: TimeTrialLap): void {
    const now = this.tt.world.time;
    if (this.best !== null && lap.time >= this.best) {
      const off = lap.time - this.best;
      this.notice = { text: `${formatLapTime(lap.time)} · +${off.toFixed(3)} to your best`, color: '#ffffff', until: now + 4 };
      return;
    }
    this.best = lap.time;
    savePersonalGhost(lap.ghost, this.player);
    this.personal = this.load(lap.ghost);
    const isRecord = lap.time < (this.board[0]?.time ?? Infinity);
    const entry: TimeEntry = { player: this.player, name: this.tt.me.name, time: lap.time, sectors: lap.sectors };
    const position = this.board.filter((e) => e.player !== this.player && e.time < lap.time).length + 1;
    this.notice = isRecord
      ? { text: `NEW RECORD! ${formatLapTime(lap.time)}`, color: '#b84dff', until: now + 5 }
      : { text: `PERSONAL BEST ${formatLapTime(lap.time)} · P${position}`, color: '#2ecc40', until: now + 5 };
    // Show it straight away; the saved board replaces this once it's back.
    this.board = [...this.board.filter((e) => e.player !== this.player), entry].sort((a, b) => a.time - b.time);
    // Beat the player whose ghost we chose: race the next one up instead (our own at the top).
    const chosen = this.board.find((e) => e.player === this.ghostChoice);
    if (chosen && chosen.time >= lap.time) this.ghostChoice = this.nextTarget();
    this.store
      .submit(this.trackId, entry, lap.ghost)
      .then(() => this.refresh())
      .catch((err) => {
        console.warn(err);
        this.notice = { text: "Couldn't save the lap to the leaderboard", color: '#ff4136', until: this.tt.world.time + 4 };
      });
  }

  /** G: the next ghost (the fastest other players, then your best, then none). */
  handleKeys(keyboard: Keyboard): void {
    if (!keyboard.wasPressed('KeyG')) return;
    const order = [...this.board.filter((e) => e.player !== this.player).slice(0, GHOST_PLAYERS).map((e) => e.player), 'personal', 'off'];
    this.ghostChoice = order[(order.indexOf(this.ghostKey()) + 1) % order.length];
    this.notice = { text: `GHOST: ${this.ghostLabel().toUpperCase()}`, color: GHOST_COLOR, until: this.tt.world.time + 2 };
  }

  /** The ghost being raced: a player id, 'personal' or 'off'. */
  private ghostKey(): string {
    if (this.ghostChoice !== 'auto') return this.ghostChoice;
    // The record holder's lap: our own best once we hold the record (or nobody else has a time).
    const leader = this.board[0];
    return leader && leader.player !== this.player ? leader.player : 'personal';
  }

  /** The player just ahead of us on the board, or our own best if nobody is. */
  private nextTarget(): string {
    const mine = this.board.findIndex((e) => e.player === this.player);
    const ahead = mine === -1 ? this.board[this.board.length - 1] : this.board[mine - 1];
    return ahead?.player ?? 'personal';
  }

  private ghostLabel(): string {
    const key = this.ghostKey();
    if (key === 'off') return 'off';
    if (key === 'personal') return 'your best';
    const pos = this.board.findIndex((e) => e.player === key);
    return pos === -1 ? 'player' : `P${pos + 1} ${this.board[pos].name}`;
  }

  private activeGhost(): LoadedGhost | null {
    const key = this.ghostKey();
    if (key === 'off') return null;
    if (key === 'personal') return this.personal;
    if (!this.playerGhosts.has(key)) {
      this.playerGhosts.set(key, null);
      this.store
        .ghostOf(this.trackId, key)
        .then((g) => g && this.playerGhosts.set(key, this.load(g)))
        .catch((err) => console.warn(err));
    }
    return this.playerGhosts.get(key) ?? null;
  }

  ghostCars(): GhostCar[] {
    const g = this.activeGhost();
    const t = this.tt.lapTime();
    if (!g || t === null) return [];
    const p = ghostPose(g.ghost, t);
    return p ? [{ ...p, color: GHOST_COLOR, label: `${g.ghost.name} ${formatLapTime(g.ghost.time)}` }] : [];
  }

  drawOverlay(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    drawLeaderboard(ctx, {
      rows: this.board,
      me: this.player,
      state: this.boardState,
      global: this.store.global,
      trackName: this.track.name,
      ghost: this.ghostLabel(),
    });
    const now = this.tt.world.time;
    const inv = this.tt.invalidAt;
    if (inv !== null && now - inv < PROMPT_TIME) drawInvalidPrompt(ctx, this.tt.invalidReason, width, height);
    if (this.notice && this.notice.until > now) drawNotice(ctx, this.notice.text, this.notice.color, width, height);
  }

  world() {
    return this.tt.world;
  }
  session() {
    return null;
  }
  now() {
    return this.tt.world.time;
  }
  /** Live gap to the ghost being shown, else to our best lap this visit. */
  delta() {
    const me = this.tt.me;
    const t = this.tt.lapTime();
    const s = me.timer.lapDistance;
    const g = this.activeGhost();
    if (g && t !== null && s !== null) return ghostDelta(g.trace, t, s);
    return me.timer.delta(this.tt.world.time);
  }
  step(dt: number, input: PlayerInput) {
    const { tt } = this;
    if (tt.world.time - this.lastRefresh > REFRESH_EVERY) void this.refresh();
    // R or ENTER: straight back to the start, at any time.
    const restart = input.ready === true || input.reset === true;
    if ((restart && !this.restartDown) || this.restartRequested) tt.restart();
    this.restartRequested = false;
    this.restartDown = input.ready === true;
    for (const e of tt.step(dt, input)) {
      // Lap times get their own notices here (against the leaderboard, not just this visit).
      if (e.kind !== 'lap') this.events.push(e);
      else if (!e.lap.valid) this.notice = { text: `${formatLapTime(e.lap.time)} · not counted`, color: '#888888', until: tt.world.time + 4 };
    }
  }
  recoverAt() {
    return null;
  }
  safetyCar() {
    return null;
  }
  net() {
    return [];
  }
  endFrame() {}
  pose(r: Racer, alpha: number): Pose {
    const c = r.car;
    return {
      x: c.prevX + (c.x - c.prevX) * alpha,
      y: c.prevY + (c.y - c.prevY) * alpha,
      heading: c.prevHeading + (c.heading - c.prevHeading) * alpha,
    };
  }
  takeEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }
}
