import type { Track } from '../track/track';
import { DRY_COMPOUNDS } from './tyres';
import { penaltyTime, RaceWorld, type PlayerInput, type Racer, type WorldEvent } from './world';

export type Weather = 'dry' | 'wet' | 'rain' | 'drying';

/** Chosen by the lobby host. */
export interface RaceSettings {
  trackId: string;
  laps: number;
  qualifying: boolean;
  weather: Weather;
  /** Dry races: at least one stop and two different dry compounds, or +30 s. */
  mandatoryStop: boolean;
  /** Seconds between cars being released in qualifying. */
  releaseGap: number;
}

export const DEFAULT_SETTINGS: RaceSettings = {
  trackId: 'silverstone',
  laps: 5,
  qualifying: true,
  weather: 'dry',
  mandatoryStop: true,
  releaseGap: 10,
};

export interface PlayerInfo {
  id: string;
  name: string;
  color: string;
}

/**
 * - qualifying: cars are released one at a time; out-lap + one timed lap, no collisions.
 * - grid: cars line up in qualifying order (held still).
 * - lights: five red lights, then lights out. Moving before that is a jump start.
 * - race / finished.
 */
export type SessionPhase = 'qualifying' | 'grid' | 'lights' | 'race' | 'finished';

export interface QualiEntry {
  releaseAt: number;
  status: 'waiting' | 'outLap' | 'flying' | 'done';
  /** Timed lap, or null if none / deleted. */
  time: number | null;
}

export interface Standing {
  id: string;
  position: number;
  laps: number;
  /** Seconds behind the leader (race), or behind pole (qualifying). Null if unknown. */
  gap: number | null;
  status: 'running' | 'finished' | 'dnf' | 'pit';
  penalties: number;
  bestLap: number | null;
  /** Race time including penalties, once finished. */
  totalTime: number | null;
}

export type SessionEvent =
  | WorldEvent
  | { kind: 'phase'; phase: SessionPhase }
  | { kind: 'finished'; racerId: string; position: number };

const GRID_TIME = 4;
const LIGHT_INTERVAL = 1;
const QUALI_TIME_LIMIT = 240;
const FINISH_TIMEOUT = 60;
const GRID_SPACING = 8;
const JUMP_START_DISTANCE = 1;
const JUMP_START_PENALTY = 5;
const TRACK_LIMIT_FREE_WARNINGS = 3;
const TRACK_LIMIT_PENALTY = 5;
const MANDATORY_STOP_PENALTY = 30;
const GAP_BUCKET = 25;

export class Session {
  readonly world: RaceWorld;
  phase: SessionPhase;
  phaseStart = 0;
  readonly quali = new Map<string, QualiEntry>();
  gridOrder: string[] = [];
  /** Red lights showing (0-5), and when they go out. */
  lights = 0;
  private lightsOutAt = 0;
  raceStart = 0;
  private readonly gridSlots = new Map<string, { x: number; y: number }>();
  private readonly finishTimes = new Map<string, number>();
  private readonly finishOrder: string[] = [];
  private firstFinishAt: number | null = null;
  /** Race time at each GAP_BUCKET metres of race distance, per car (for gaps). */
  private readonly progressTimes = new Map<string, number[]>();

  constructor(
    readonly track: Track,
    readonly settings: RaceSettings,
    players: PlayerInfo[],
  ) {
    this.world = new RaceWorld(track, { drsRule: 'free', wetness: 0, slipstream: false });
    for (const p of players) this.world.addRacer(p.id, p.name, p.color, 'medium');
    this.world.options.wetness = this.wetnessAt(0);
    this.phase = settings.qualifying ? 'qualifying' : 'grid';
    if (settings.qualifying) this.startQualifying();
    else this.startGrid(players.map((p) => p.id));
  }

  step(dt: number, inputs: ReadonlyMap<string, PlayerInput>): SessionEvent[] {
    const events: SessionEvent[] = [];
    const now = this.world.time;
    this.world.options.wetness = this.wetnessAt(now);

    if (this.phase === 'grid' || this.phase === 'lights') {
      // Drivers pick their starting tyres (keys 1-5) until the lights go out.
      for (const r of this.world.racers) {
        const choice = inputs.get(r.id)?.nextTyre;
        if (choice && choice !== r.tyres.compound) {
          r.tyres.compound = choice;
          r.compoundsUsed = [choice];
        }
      }
    }

    const worldEvents = this.world.step(dt, inputs);
    events.push(...worldEvents);

    switch (this.phase) {
      case 'qualifying':
        this.updateQualifying(worldEvents, events);
        break;
      case 'grid':
        if (now - this.phaseStart >= GRID_TIME) this.setPhase('lights', events);
        break;
      case 'lights':
        this.updateLights(events);
        break;
      case 'race':
        this.updateRace(worldEvents, events);
        break;
      case 'finished':
        break;
    }
    return events;
  }

  // ---------- Qualifying

  private startQualifying(): void {
    this.world.options.drsRule = 'free';
    this.world.options.slipstream = false;
    const start = this.qualiStart();
    this.world.racers.forEach((r, i) => {
      this.world.resetRacer(r, start.x, start.y, start.heading, r.input.nextTyre);
      r.frozen = true;
      this.quali.set(r.id, { releaseAt: 3 + i * this.settings.releaseGap, status: 'waiting', time: null });
    });
  }

  /** Cars start their out-lap from the pit exit (or just after the line without a pit lane). */
  private qualiStart(): { x: number; y: number; heading: number } {
    const at = this.track.pit ? this.track.pit.exit + 10 : 20;
    const t = this.track.samples[Math.floor(at / 2) % this.track.samples.length];
    return { x: t.x, y: t.y, heading: Math.atan2(t.ty, t.tx) };
  }

  private updateQualifying(worldEvents: WorldEvent[], events: SessionEvent[]): void {
    const now = this.world.time;
    for (const r of this.world.racers) {
      const q = this.quali.get(r.id)!;
      if (q.status === 'waiting' && now >= q.releaseAt) {
        q.status = 'outLap';
        r.frozen = false;
      }
      if (q.status === 'outLap' && r.timer.lapStart !== null) q.status = 'flying';
      if (q.status !== 'done' && r.car.retired) q.status = 'done';
    }
    for (const e of worldEvents) {
      if (e.kind !== 'lap') continue;
      const q = this.quali.get(e.racerId)!;
      if (q.status !== 'flying') continue;
      q.status = 'done';
      q.time = e.lap.valid ? e.lap.time : null;
      // Done: park the car so it's out of the way.
      this.world.racer(e.racerId)!.frozen = true;
    }
    const last = Math.max(...[...this.quali.values()].map((q) => q.releaseAt));
    const allDone = [...this.quali.values()].every((q) => q.status === 'done');
    if (allDone || now > last + QUALI_TIME_LIMIT) {
      const order = this.world.racers
        .map((r, i) => ({ id: r.id, i, time: this.quali.get(r.id)!.time }))
        .sort((a, b) => (a.time ?? Infinity) - (b.time ?? Infinity) || a.i - b.i)
        .map((e) => e.id);
      this.startGrid(order);
      this.setPhase('grid', events);
    }
  }

  // ---------- Grid and lights

  private startGrid(order: string[]): void {
    this.gridOrder = order;
    const n = this.track.samples.length;
    order.forEach((id, k) => {
      const r = this.world.racer(id)!;
      // Staggered two-wide grid behind the start line, pole on the left.
      const s = this.track.length - (10 + k * GRID_SPACING);
      const t = this.track.samples[Math.floor(s / 2) % n];
      const lateral = (k % 2 === 0 ? -1 : 1) * t.halfWidth * 0.45;
      const x = t.x + t.nx * lateral;
      const y = t.y + t.ny * lateral;
      this.world.resetRacer(r, x, y, Math.atan2(t.ty, t.tx), r.input.nextTyre);
      r.frozen = true;
      r.car.allowReverse = false;
      this.gridSlots.set(id, { x, y });
    });
    this.world.options.drsRule = 'race';
    this.world.options.slipstream = true;
    this.phaseStart = this.world.time;
  }

  private updateLights(events: SessionEvent[]): void {
    const t = this.world.time - this.phaseStart;
    if (this.lights === 0) {
      for (const r of this.world.racers) r.frozen = false;
      // Lights stay on for a random-looking 0.5-2.5 s (same on every machine).
      this.lightsOutAt = 5 * LIGHT_INTERVAL + 0.5 + 2 * fract(Math.sin(this.world.racers.length * 12.9898 + this.track.length) * 43758.5);
    }
    this.lights = Math.min(5, Math.floor(t / LIGHT_INTERVAL) + 1);
    for (const r of this.world.racers) {
      const slot = this.gridSlots.get(r.id)!;
      // Only moving forwards counts (rolling back slightly is not a jump start).
      const moved = (r.car.x - slot.x) * Math.cos(r.car.heading) + (r.car.y - slot.y) * Math.sin(r.car.heading);
      if (moved > JUMP_START_DISTANCE && !r.penalties.some((p) => p.reason === 'Jump start')) {
        this.world.addPenalty(r, JUMP_START_PENALTY, 'Jump start', events as WorldEvent[]);
      }
    }
    if (t >= this.lightsOutAt) {
      this.lights = 0;
      this.raceStart = this.world.time;
      for (const r of this.world.racers) r.car.allowReverse = true;
      this.setPhase('race', events);
    }
  }

  // ---------- Race

  private updateRace(worldEvents: WorldEvent[], events: SessionEvent[]): void {
    const now = this.world.time;
    for (const e of worldEvents) {
      const r = this.world.racer(e.racerId)!;
      if (e.kind === 'trackLimits' && e.warnings > TRACK_LIMIT_FREE_WARNINGS) {
        this.world.addPenalty(r, TRACK_LIMIT_PENALTY, `Track limits (warning ${e.warnings})`, events as WorldEvent[]);
      }
      if (e.kind === 'lap' && !this.finishTimes.has(r.id)) {
        if (r.timer.lapsCompleted >= this.settings.laps || this.firstFinishAt !== null) this.finish(r, events);
      }
    }
    for (const r of this.world.racers) this.recordProgress(r);

    const everyoneDone = this.world.racers.every((r) => this.finishTimes.has(r.id) || r.car.retired);
    const timedOut = this.firstFinishAt !== null && now - this.firstFinishAt > FINISH_TIMEOUT;
    if (everyoneDone || timedOut) this.setPhase('finished', events);
  }

  private finish(r: Racer, events: SessionEvent[]): void {
    const now = this.world.time;
    if (this.firstFinishAt === null) this.firstFinishAt = now;
    if (this.settings.mandatoryStop && this.isDryRace()) {
      const dry = new Set(r.compoundsUsed.filter((c) => DRY_COMPOUNDS.includes(c)));
      if (dry.size < 2) this.world.addPenalty(r, MANDATORY_STOP_PENALTY, 'No pit stop / one compound', events as WorldEvent[]);
    }
    this.finishTimes.set(r.id, now - this.raceStart);
    this.finishOrder.push(r.id);
    r.frozen = true;
    events.push({ kind: 'finished', racerId: r.id, position: this.finishOrder.length });
  }

  private isDryRace(): boolean {
    return this.settings.weather === 'dry';
  }

  /** Distance covered since the start: laps plus distance into the current lap. */
  progress(r: Racer): number {
    const s = r.timer.lapDistance ?? 0;
    const L = this.track.length;
    return r.timer.lapsCompleted * L + (r.timer.lapStart !== null ? s : s - L);
  }

  private recordProgress(r: Racer): void {
    const times = this.progressTimes.get(r.id) ?? [];
    this.progressTimes.set(r.id, times);
    const bucket = Math.floor(this.progress(r) / GAP_BUCKET);
    if (bucket >= 0 && times[bucket] === undefined) times[bucket] = this.world.time;
  }

  /** Current order with gaps. During qualifying: by lap time. */
  standings(): Standing[] {
    const racers = this.world.racers;
    const best = (r: Racer) => r.timer.bestLap?.time ?? null;
    if (this.phase === 'qualifying') {
      const sorted = [...racers].sort(
        (a, b) => (this.quali.get(a.id)!.time ?? Infinity) - (this.quali.get(b.id)!.time ?? Infinity),
      );
      const pole = this.quali.get(sorted[0]?.id)?.time ?? null;
      return sorted.map((r, i) => {
        const t = this.quali.get(r.id)!.time;
        return {
          id: r.id,
          position: i + 1,
          laps: r.timer.lapsCompleted,
          gap: t !== null && pole !== null ? t - pole : null,
          status: r.car.retired ? 'dnf' : 'running',
          penalties: 0,
          bestLap: t,
          totalTime: null,
        };
      });
    }
    if (this.phase === 'grid' || this.phase === 'lights') {
      return this.gridOrder.map((id, i) => {
        const r = this.world.racer(id)!;
        return { id, position: i + 1, laps: 0, gap: null, status: 'running', penalties: penaltyTime(r), bestLap: null, totalTime: null };
      });
    }

    const finished = this.finishOrder.map((id) => this.world.racer(id)!);
    // Finished cars are ordered by race time including penalties.
    finished.sort((a, b) => this.finishTimes.get(a.id)! + penaltyTime(a) - (this.finishTimes.get(b.id)! + penaltyTime(b)));
    const running = racers
      .filter((r) => !this.finishTimes.has(r.id) && !r.car.retired)
      .sort((a, b) => this.progress(b) - this.progress(a));
    const dnf = racers.filter((r) => !this.finishTimes.has(r.id) && r.car.retired);
    const order = [...finished, ...running, ...dnf];
    const leader = order[0];
    return order.map((r, i) => {
      const finishTime = this.finishTimes.get(r.id);
      return {
        id: r.id,
        position: i + 1,
        laps: r.timer.lapsCompleted,
        gap: this.gapTo(leader, r),
        status: finishTime !== undefined ? 'finished' : r.car.retired ? 'dnf' : r.pit.phase !== 'out' ? 'pit' : 'running',
        penalties: penaltyTime(r),
        bestLap: best(r),
        totalTime: finishTime !== undefined ? finishTime + penaltyTime(r) : null,
      };
    });
  }

  private gapTo(leader: Racer, r: Racer): number | null {
    if (leader === r) return 0;
    const lt = this.finishTimes.get(leader.id);
    const rt = this.finishTimes.get(r.id);
    if (lt !== undefined && rt !== undefined) return rt + penaltyTime(r) - (lt + penaltyTime(leader));
    const mine = this.progressTimes.get(r.id);
    const theirs = this.progressTimes.get(leader.id);
    if (!mine || !theirs || mine.length === 0) return null;
    const bucket = mine.length - 1;
    const ref = theirs[bucket];
    return ref === undefined ? null : mine[bucket] - ref;
  }

  // ---------- Helpers

  private setPhase(phase: SessionPhase, events: SessionEvent[]): void {
    this.phase = phase;
    this.phaseStart = this.world.time;
    events.push({ kind: 'phase', phase });
  }

  /** Track wetness over time for the chosen weather. */
  wetnessAt(time: number): number {
    const expected = this.settings.laps * 75 + (this.settings.qualifying ? 120 : 0);
    const ramp = (start: number) => Math.min(1, Math.max(0, (time - start) / 60));
    switch (this.settings.weather) {
      case 'dry':
        return 0;
      case 'wet':
        return 1;
      case 'rain':
        return ramp(expected * 0.45);
      case 'drying':
        return 1 - ramp(expected * 0.35);
    }
  }
}

function fract(x: number): number {
  return x - Math.floor(x);
}

