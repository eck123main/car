import type { Keyboard } from '../game/input';
import { loadPersonalGhost, playerId, savePersonalGhost, type Leaderboard, type TimeEntry } from '../net/leaderboard';
import type { Pose } from '../net/client';
import { formatLapTime } from '../render/hud';
import { drawInvalidPrompt, drawLeaderboard, drawNotice, GHOST_COLOR } from '../render/timeTrialHud';
import { ghostDelta, ghostPose, ghostTrace, type Ghost } from '../sim/ghost';
import { RESET_WAIT, type SessionEvent } from '../sim/session';
import { TimeTrial, type TimeTrialLap } from '../sim/timeTrial';
import type { PlayerInput, Racer } from '../sim/world';
import type { Track } from '../track/track';
import type { GameDriver, GhostCar } from './game';

/** The player's car in time trial (the ghost is GHOST_COLOR, so they never look alike). */
export const TIME_TRIAL_COLOR = '#e10600';
/** How long the "lap invalid" prompt stays up (s). */
const PROMPT_TIME = 6;

type GhostMode = 'record' | 'personal' | 'off';

/** Time trial on one machine: alone on track against the leaderboard and a ghost. */
export class TimeTrialDriver implements GameDriver {
  readonly meId = 'me';
  readonly pausable = true;
  readonly resetHint = 'R: back on track (5 s wait) · ENTER: restart from the line';
  readonly tt: TimeTrial;
  private recovering: number | null = null;
  private events: SessionEvent[] = [];
  private enterDown = false;
  private board: TimeEntry[] = [];
  private boardState: 'loading' | 'ok' | 'error' = 'loading';
  private readonly player = playerId();
  private ghosts: Record<'record' | 'personal', { ghost: Ghost; trace: number[] } | null> = { record: null, personal: null };
  private ghostMode: GhostMode = 'record';
  private notice: { text: string; color: string; until: number } | null = null;
  /** Our best lap time on this track (from the leaderboard or this browser). */
  private best: number | null = null;

  constructor(
    private readonly track: Track,
    private readonly trackId: string,
    name: string,
    private readonly store: Leaderboard,
  ) {
    this.tt = new TimeTrial(track, trackId, name, TIME_TRIAL_COLOR);
    this.tt.onLap = (lap) => this.lapDone(lap);
    const pb = loadPersonalGhost(trackId);
    if (pb) {
      this.setGhost('personal', pb);
      this.best = pb.time;
    }
    void this.refresh(true);
  }

  /** Reload the leaderboard (and the record ghost, if it may have changed). */
  private async refresh(withGhost: boolean): Promise<void> {
    try {
      this.board = await this.store.top(this.trackId, 50);
      this.boardState = 'ok';
      const mine = this.board.find((e) => e.player === this.player);
      if (mine && (this.best === null || mine.time < this.best)) this.best = mine.time;
      if (withGhost) {
        const g = await this.store.recordGhost(this.trackId);
        if (g) this.setGhost('record', g);
      }
    } catch (err) {
      console.warn(err);
      this.boardState = 'error';
    }
  }

  private setGhost(kind: 'record' | 'personal', ghost: Ghost): void {
    this.ghosts[kind] = { ghost, trace: ghostTrace(ghost, this.track) };
  }

  private lapDone(lap: TimeTrialLap): void {
    const now = this.tt.world.time;
    if (this.best !== null && lap.time >= this.best) {
      const off = lap.time - this.best;
      this.notice = { text: `${formatLapTime(lap.time)} · +${off.toFixed(3)} to your best`, color: '#ffffff', until: now + 4 };
      return;
    }
    this.best = lap.time;
    savePersonalGhost(lap.ghost);
    this.setGhost('personal', lap.ghost);
    const record = this.board[0]?.time ?? Infinity;
    const isRecord = lap.time < record;
    if (isRecord) this.setGhost('record', lap.ghost);
    const entry: TimeEntry = { player: this.player, name: this.tt.me.name, time: lap.time, sectors: lap.sectors };
    const position = this.board.filter((e) => e.player !== this.player && e.time < lap.time).length + 1;
    this.notice = isRecord
      ? { text: `NEW RECORD! ${formatLapTime(lap.time)}`, color: '#b84dff', until: now + 5 }
      : { text: `PERSONAL BEST ${formatLapTime(lap.time)} · P${position}`, color: '#2ecc40', until: now + 5 };
    // Show it straight away; the saved board replaces this once it's back.
    this.board = [...this.board.filter((e) => e.player !== this.player), entry].sort((a, b) => a.time - b.time);
    this.store
      .submit(this.trackId, entry, lap.ghost)
      .then(() => this.refresh(false))
      .catch((err) => {
        console.warn(err);
        this.notice = { text: "Couldn't save the lap to the leaderboard", color: '#ff4136', until: this.tt.world.time + 4 };
      });
  }

  handleKeys(keyboard: Keyboard): void {
    if (!keyboard.wasPressed('KeyG')) return;
    const order: GhostMode[] = ['record', 'personal', 'off'];
    this.ghostMode = order[(order.indexOf(this.ghostMode) + 1) % order.length];
    const text = this.ghostMode === 'off' ? 'GHOST OFF' : this.ghostMode === 'record' ? 'GHOST: RECORD LAP' : 'GHOST: YOUR BEST LAP';
    this.notice = { text, color: GHOST_COLOR, until: this.tt.world.time + 2 };
  }

  private activeGhost(): { ghost: Ghost; trace: number[] } | null {
    return this.ghostMode === 'off' ? null : this.ghosts[this.ghostMode];
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
      ghost: this.ghostMode,
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
    const me = tt.me;
    // ENTER: restart from the line, at any time.
    const enter = input.ready === true;
    if (enter && !this.enterDown) {
      this.recovering = null;
      tt.restart();
    }
    this.enterDown = enter;
    if (input.reset && this.recovering === null) {
      this.recovering = tt.world.time + RESET_WAIT;
      me.frozen = true;
    }
    if (this.recovering !== null && tt.world.time >= this.recovering) {
      this.recovering = null;
      me.frozen = false;
      this.backOnTrack(me);
    }
    for (const e of tt.step(dt, input)) {
      // Lap times get their own notices here (against the leaderboard, not just this visit).
      if (e.kind !== 'lap') this.events.push(e);
      else if (!e.lap.valid) this.notice = { text: `${formatLapTime(e.lap.time)} · not counted`, color: '#888888', until: tt.world.time + 4 };
    }
  }
  recoverAt() {
    return this.recovering;
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

  /** R: back on the centreline nearest the car; the lap in progress is lost. */
  private backOnTrack(me: Racer): void {
    const ss = this.track.samples;
    const i = this.track.query(me.car.x, me.car.y, me.car.trackIndex)?.index ?? ss.length - 10;
    const s = ss[i];
    me.car.place(s.x, s.y, Math.atan2(s.ty, s.tx), i);
    me.car.repair();
    me.timer.abortLap();
    me.pit.phase = 'out';
  }
}
