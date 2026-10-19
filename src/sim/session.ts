import type { Track } from '../track/track';
import { HIT_NAMES, ItemSystem, KNOCKOUT_WAIT, newItemState, type ItemHit } from './items';
import { SafetyCar, SC_LEAD, SC_SLOW_CAR } from './safetyCar';
import { DRY_COMPOUNDS } from './tyres';
import { penaltyTime, raceProgress, RaceWorld, type PlayerInput, type Racer, type WorldEvent } from './world';

export type Weather = 'dry' | 'wet' | 'rain' | 'drying';
/** 'classic': a normal F1 race. 'party': the same, plus Mario Kart style item boxes. */
export type GameMode = 'classic' | 'party';

/** Chosen by the lobby host. */
export interface RaceSettings {
  mode: GameMode;
  trackId: string;
  laps: number;
  qualifying: boolean;
  weather: Weather;
  /** Dry races: at least one stop and two different dry compounds, or +30 s. */
  mandatoryStop: boolean;
  /** Seconds between cars being released in qualifying. */
  releaseGap: number;
  /** A big crash brings out the safety car. */
  safetyCar: boolean;
  /** Tyres wear (always off in races under 5 laps without a mandatory stop). */
  tyreWear: boolean;
  /** Cars pass through each other in the race (slipstream and DRS still work). */
  noContact: boolean;
}

export const DEFAULT_SETTINGS: RaceSettings = {
  mode: 'classic',
  trackId: 'silverstone',
  laps: 5,
  qualifying: true,
  weather: 'dry',
  mandatoryStop: true,
  releaseGap: 10,
  safetyCar: true,
  tyreWear: true,
  noContact: false,
};

/** Races shorter than this with no stop to make are too short for tyre wear to matter. */
export const SHORT_RACE_LAPS = 5;

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
  /** Laps behind the leader (lapped cars). */
  lapsDown: number;
  status: 'running' | 'finished' | 'dnf' | 'pit';
  penalties: number;
  bestLap: number | null;
  /** Race time including penalties, once finished. */
  totalTime: number | null;
}

export type SessionEvent =
  | WorldEvent
  | { kind: 'reset'; racerId: string; note: string }
  /** Party mode: something an item did to (or for) this driver. */
  | { kind: 'item'; racerId: string; text: string }
  | { kind: 'phase'; phase: SessionPhase }
  | { kind: 'finished'; racerId: string; position: number }
  /** Safety car out, coming in this lap, gone in (restart at the line), and racing again. */
  | { kind: 'safetyCar'; state: 'deployed' | 'inThisLap' | 'in' | 'green' };

/** On the grid: at least this long, at most GRID_MAX_TIME while drivers pick tyres. */
const GRID_MIN_TIME = 3;
export const GRID_MAX_TIME = 20;
const LIGHT_INTERVAL = 1;
const QUALI_TIME_LIMIT = 240;
const FINISH_TIMEOUT = 180;
const GRID_SPACING = 8;
const JUMP_START_DISTANCE = 1;
const JUMP_START_PENALTY = 5;
const MANDATORY_STOP_PENALTY = 30;
const GAP_BUCKET = 25;
/** Safety car: at most this many per race, this far apart (s). */
const MAX_SAFETY_CARS = 2;
const SAFETY_CAR_COOLDOWN = 60;
/** Out for at least this long (s), and comes in after this long whatever happens. */
const SAFETY_CAR_MIN_TIME = 25;
const SAFETY_CAR_MAX_TIME = 90;
/** After this long (s) it only waits for the leader, not every last car. */
const SAFETY_CAR_STRAGGLER_TIME = 60;
const SAFETY_CAR_LEADER_GAP = 60;
/** It comes in once every car has caught up: within this much track per car in the queue (m). */
const SAFETY_CAR_QUEUE_GAP = 45;
/** A car must be this far (m) ahead of another before it counts as having passed it. */
const PASS_MARGIN = 6;
/** One penalty at most per driver per safety car (passing it or overtaking under it). */
const SAFETY_CAR_PENALTY = 5;
/** A car that has just come out of the pits can be passed (or pass) for this long (s) while it gets up to speed. */
const PIT_REJOIN_GRACE = 5;
/** Seconds a reset car waits before going back on track. */
export const RESET_WAIT = 5;

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
  /** Cars waiting to be put back on track, and when. */
  readonly recovering = new Map<string, number>();
  /** Drivers ready on the grid. */
  readonly ready = new Set<string>();
  /** The safety car, while it is on track. */
  safetyCar: SafetyCar | null = null;
  /** Party mode: item boxes, held items and rockets. */
  readonly items: ItemSystem | null;
  /**
   * Cars that may not overtake: everyone while the safety car is out, then each car until
   * it crosses the line at the restart.
   */
  readonly noOvertaking = new Set<string>();
  private safetyCars = 0;
  private safetyCarEndedAt = -Infinity;
  private restartPending = false;
  /** DRS comes back when the leader has completed this many laps (a lap after the restart). */
  private drsBackAtLap = 0;
  private readonly wrecked = new Set<string>();
  /** Drivers already penalised under this safety car: one penalty each is enough. */
  private readonly safetyCarPenalised = new Set<string>();
  /** When each car was last in the pit lane. */
  private readonly lastInPits = new Map<string, number>();
  /** For each pair of cars under the no-overtaking rule, which one is ahead. */
  private readonly pairOrder = new Map<string, number>();

  constructor(
    readonly track: Track,
    readonly settings: RaceSettings,
    players: PlayerInfo[],
  ) {
    this.world = new RaceWorld(track, { drsRule: 'free', wetness: 0, slipstream: false, collisions: false });
    this.items = settings.mode === 'party' ? new ItemSystem(track) : null;
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

    for (const r of this.world.racers) if (inputs.get(r.id)?.reset) this.requestReset(r, events);
    this.finishResets(events);
    const worldEvents = this.world.step(dt, inputs);
    events.push(...worldEvents);

    switch (this.phase) {
      case 'qualifying':
        this.updateQualifying(worldEvents, events);
        break;
      case 'grid':
        {
          // Lights once everyone has picked their tyres and is ready (or time is up).
          const waited = now - this.phaseStart;
          for (const r of this.world.racers) if (inputs.get(r.id)?.ready) this.ready.add(r.id);
          const allReady = this.world.racers.every((r) => this.ready.has(r.id) || r.car.retired);
          if ((allReady && waited >= GRID_MIN_TIME) || waited >= GRID_MAX_TIME) this.setPhase('lights', events);
        }
        break;
      case 'lights':
        this.updateLights(events);
        break;
      case 'race':
        this.updateRace(dt, worldEvents, events);
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
    this.world.options.collisions = false;
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
    this.recovering.clear();
    this.ready.clear();
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
    this.world.options.collisions = !this.settings.noContact;
    this.world.options.raceLaps = this.settings.laps;
    this.world.options.tyreWear = this.tyreWear;
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

  private updateRace(dt: number, worldEvents: WorldEvent[], events: SessionEvent[]): void {
    const now = this.world.time;
    for (const e of worldEvents) {
      const r = this.world.racer(e.racerId)!;
      if (e.kind === 'lap' && !this.finishTimes.has(r.id)) {
        if (r.timer.lapsCompleted >= this.settings.laps || this.firstFinishAt !== null) this.finish(r, events);
      }
    }
    for (const r of this.world.racers) {
      this.recordProgress(r);
      if (r.pit.phase !== 'out') this.lastInPits.set(r.id, now);
    }
    this.updateSafetyCar(dt, worldEvents, events);
    if (this.items) {
      for (const hit of this.items.step(this.world.racers, now, dt)) this.knockOut(hit, events);
      for (const n of this.items.notes) events.push({ kind: 'item', ...n });
      this.items.notes = [];
    }

    const everyoneDone = this.world.racers.every((r) => this.finishTimes.has(r.id) || r.car.retired);
    // Everyone still running (lapped cars too) finishes the next time they cross the line;
    // the timeout is only a safety net for someone who has parked up.
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
    this.noOvertaking.delete(r.id);
    r.frozen = true;
    events.push({ kind: 'finished', racerId: r.id, position: this.finishOrder.length });
  }

  private isDryRace(): boolean {
    return this.settings.weather === 'dry';
  }

  /** The two-compound rule applies this race. */
  get mandatoryStop(): boolean {
    return this.settings.mandatoryStop && this.isDryRace();
  }

  /** Do tyres wear this race? Off by the host, or in a short race with no stop to make. */
  get tyreWear(): boolean {
    return this.settings.tyreWear !== false && (this.settings.laps >= SHORT_RACE_LAPS || this.mandatoryStop);
  }

  /** Distance covered since the start: laps plus distance into the current lap. */
  progress(r: Racer): number {
    return raceProgress(r, this.track.length);
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
          lapsDown: 0,
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
        return { id, position: i + 1, laps: 0, gap: null, lapsDown: 0, status: 'running', penalties: penaltyTime(r), bestLap: null, totalTime: null };
      });
    }

    const finished = this.finishOrder.map((id) => this.world.racer(id)!);
    // Finished cars are ordered by race time including penalties.
    // Full distance first, then race time including penalties.
    finished.sort(
      (a, b) =>
        b.timer.lapsCompleted - a.timer.lapsCompleted ||
        this.finishTimes.get(a.id)! + penaltyTime(a) - (this.finishTimes.get(b.id)! + penaltyTime(b)),
    );
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
        lapsDown: this.lapsDown(leader, r),
        status: finishTime !== undefined ? 'finished' : r.car.retired ? 'dnf' : r.pit.phase !== 'out' ? 'pit' : 'running',
        penalties: penaltyTime(r),
        bestLap: best(r),
        totalTime: finishTime !== undefined ? finishTime + penaltyTime(r) : null,
      };
    });
  }

  /** How many laps behind the leader a car is (finished cars: by laps completed). */
  private lapsDown(leader: Racer, r: Racer): number {
    if (this.finishTimes.has(r.id)) return Math.max(0, leader.timer.lapsCompleted - r.timer.lapsCompleted);
    return Math.max(0, Math.floor((this.progress(leader) - this.progress(r)) / this.track.length));
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

  // ---------- Safety car

  /**
   * A wreck brings out the safety car (if the host allows it). It drives at an easy pace
   * ahead of the leader; nobody may pass it or overtake each other, and DRS is off. Once
   * the wreck is cleared and the field has caught up, it comes in at the end of the lap and
   * racing restarts at the line.
   */
  private updateSafetyCar(dt: number, worldEvents: WorldEvent[], events: SessionEvent[]): void {
    const now = this.world.time;
    const running = this.world.racers.filter((r) => !this.finishTimes.has(r.id) && !r.car.retired);
    let leader: Racer | null = null;
    for (const r of running) if (!leader || this.progress(r) > this.progress(leader)) leader = r;
    let newWreck = false;
    for (const r of this.world.racers) {
      if (r.car.retired && !this.wrecked.has(r.id)) {
        this.wrecked.add(r.id);
        newWreck = true;
      } else if (!r.car.retired) this.wrecked.delete(r.id);
    }

    const sc = this.safetyCar;
    if (!sc) {
      if (newWreck && leader && this.canDeploySafetyCar(leader)) {
        this.safetyCar = new SafetyCar(this.track, this.progress(leader) + SC_LEAD, now);
        this.safetyCars++;
        this.restartPending = false;
        this.pairOrder.clear();
        this.safetyCarPenalised.clear();
        for (const r of this.world.racers) if (!this.finishTimes.has(r.id)) this.noOvertaking.add(r.id);
        events.push({ kind: 'safetyCar', state: 'deployed' });
      }
    } else {
      const before = sc.s;
      // The first car on track behind it (the leader may be in the pits).
      let gap = Infinity;
      for (const r of running) if (r.pit.phase === 'out' && !r.frozen) gap = Math.min(gap, sc.progress - this.progress(r));
      sc.step(dt, gap === Infinity ? 0 : Math.max(0, gap));
      const out = now - sc.deployedAt;
      if (this.firstFinishAt !== null) {
        // The race finished behind the safety car.
        this.safetyCar = null;
      } else if (sc.phase === 'deployed') {
        const wreckOnTrack =
          this.world.racers.some((r) => r.car.retired && !this.finishTimes.has(r.id)) || this.recovering.size > 0;
        const caughtUp = this.queueFormed(sc, running);
        // After a while, a straggler (a damaged car, say) need not hold everyone up.
        const leaderWith = leader !== null && sc.progress - this.progress(leader) < SAFETY_CAR_LEADER_GAP;
        const ready = !wreckOnTrack && ((out >= SAFETY_CAR_MIN_TIME && caughtUp) || (out >= SAFETY_CAR_STRAGGLER_TIME && leaderWith));
        if (ready || out >= SAFETY_CAR_MAX_TIME) {
          sc.phase = 'inThisLap';
          events.push({ kind: 'safetyCar', state: 'inThisLap' });
        }
      } else {
        // In this lap: it turns into the pit lane (or off at the line, with no pit lane).
        const exit = this.track.pit?.entry ?? 0;
        const moved = this.track.forwardDistance(before, sc.s);
        const toExit = this.track.forwardDistance(before, exit);
        if (toExit > 0 && toExit <= moved) {
          this.safetyCar = null;
          this.safetyCarEndedAt = now;
          this.restartPending = true;
          this.drsBackAtLap = (leader?.timer.lapsCompleted ?? 0) + 2;
          events.push({ kind: 'safetyCar', state: 'in' });
        }
      }
      // Nobody passes the safety car.
      const car = this.safetyCar;
      if (car) {
        for (const r of running) {
          if (!this.noOvertaking.has(r.id) || r.pit.phase !== 'out' || r.frozen) continue;
          if (this.progress(r) > car.progress + 3) this.safetyCarPenalty(r, 'Passing the safety car', events);
        }
      }
    }

    // The restart: each car may race again once it crosses the line after the safety car is in.
    if (!this.safetyCar) {
      for (const e of worldEvents) {
        if (e.kind !== 'lap' || !this.noOvertaking.delete(e.racerId)) continue;
        if (this.restartPending) {
          this.restartPending = false;
          events.push({ kind: 'safetyCar', state: 'green' });
        }
      }
    }
    if (this.noOvertaking.size > 0) this.checkOvertaking(events);
    this.world.options.drsDisabled = this.safetyCar !== null || (leader?.timer.lapsCompleted ?? 0) < this.drsBackAtLap;
  }

/** Every running car is in the queue behind the safety car (measured along the track). */
  private queueFormed(sc: SafetyCar, running: Racer[]): boolean {
    const onTrack = running.filter((r) => r.pit.phase === 'out' && !r.frozen);
    const queue = SAFETY_CAR_QUEUE_GAP * Math.max(1, onTrack.length);
    return onTrack.every((r) => this.track.forwardDistance(r.timer.lapDistance ?? 0, sc.s) < queue);
  }

  private canDeploySafetyCar(leader: Racer): boolean {
    return (
      this.settings.safetyCar &&
      this.firstFinishAt === null &&
      this.safetyCars < MAX_SAFETY_CARS &&
      this.world.time - this.safetyCarEndedAt > SAFETY_CAR_COOLDOWN &&
      // Not on the last lap: there would be nothing left to restart.
      // (the leader may be the car that just crashed, so look at everyone).
      Math.max(leader.timer.lapsCompleted, ...this.world.racers.map((r) => r.timer.lapsCompleted)) < this.settings.laps - 1
    );
  }

  /**
   * No overtaking under the safety car (or before the line at the restart). Passing a car
   * that has stopped or is crawling is fine, as is anything to do with the pit lane.
   */
  private checkOvertaking(events: SessionEvent[]): void {
    const now = this.world.time;
    const bound = this.world.racers.filter(
      (r) =>
        this.noOvertaking.has(r.id) &&
        r.pit.phase === 'out' &&
        !r.frozen &&
        !r.car.retired &&
        now - (this.lastInPits.get(r.id) ?? -Infinity) > PIT_REJOIN_GRACE,
    );
    const ids = new Set(bound.map((r) => r.id));
    // Forget pairs where a car went into the pits, was reset or is free to race again.
    for (const key of [...this.pairOrder.keys()]) {
      const [a, b] = key.split('|');
      if (!ids.has(a) || !ids.has(b)) this.pairOrder.delete(key);
    }
    for (let i = 0; i < bound.length; i++) {
      for (let j = i + 1; j < bound.length; j++) {
        const [a, b] = bound[i].id < bound[j].id ? [bound[i], bound[j]] : [bound[j], bound[i]];
        const d = this.progress(a) - this.progress(b);
        if (Math.abs(d) < PASS_MARGIN) continue;
        const key = `${a.id}|${b.id}`;
        const ahead = Math.sign(d);
        const was = this.pairOrder.get(key);
        this.pairOrder.set(key, ahead);
        if (was === undefined || was === ahead) continue;
        const [passer, passed] = ahead > 0 ? [a, b] : [b, a];
        if (passed.car.speed < SC_SLOW_CAR) continue;
        this.safetyCarPenalty(passer, `Overtaking ${passed.name} under the safety car`, events);
      }
    }
  }

  private safetyCarPenalty(r: Racer, reason: string, events: SessionEvent[]): void {
    if (this.safetyCarPenalised.has(r.id)) return;
    this.safetyCarPenalised.add(r.id);
    this.world.addPenalty(r, SAFETY_CAR_PENALTY, reason, events as WorldEvent[]);
  }

  // ---------- Resets

  /**
   * R: the car waits RESET_WAIT seconds (a ghost, so nobody hits the wreck), then goes
   * back on track. Race: where it crashed, repaired; the wait is the time cost.
   * Qualifying: back to the pit exit, and a timed lap in progress is lost.
   */
  private requestReset(r: Racer, events: SessionEvent[]): void {
    if (this.recovering.has(r.id) || r.frozen || r.pit.phase !== 'out') return;
    if (this.phase === 'qualifying') {
      const q = this.quali.get(r.id)!;
      if (q.status !== 'outLap' && q.status !== 'flying') return;
      if (q.status === 'flying') {
        q.status = 'done';
        q.time = null;
      }
    } else if (this.phase !== 'race') {
      return;
    }
    this.recovering.set(r.id, this.world.time + RESET_WAIT);
    r.frozen = true;
    events.push({ kind: 'reset', racerId: r.id, note: `Recovering: back on track in ${RESET_WAIT} s` });
  }

  /** Party mode: hit by a rocket or a rainbow car. The car stops and restarts after a moment. */
  private knockOut(hit: ItemHit, events: SessionEvent[]): void {
    const r = hit.victim;
    if (this.recovering.has(r.id) || this.finishTimes.has(r.id)) return;
    this.recovering.set(r.id, this.world.time + KNOCKOUT_WAIT);
    r.frozen = true;
    // Effects end; an item you were holding is kept.
    r.items = { ...newItemState(), held: r.items.held };
    const what = HIT_NAMES[hit.how];
    if (hit.by === r) {
      events.push({ kind: 'item', racerId: r.id, text: `Hit your own ${what}!` });
      return;
    }
    events.push({ kind: 'item', racerId: r.id, text: `Hit by ${hit.by.name}'s ${what}!` });
    events.push({ kind: 'item', racerId: hit.by.id, text: `Your ${what} got ${r.name}!` });
  }

  private finishResets(events: SessionEvent[]): void {
    for (const [id, until] of this.recovering) {
      if (this.world.time < until) continue;
      this.recovering.delete(id);
      const r = this.world.racer(id);
      if (!r) continue;
      if (this.phase === 'qualifying') {
        const start = this.qualiStart();
        r.car.place(start.x, start.y, start.heading);
        r.timer.abortLap();
        // A lost timed lap ends qualifying for this driver.
        r.frozen = this.quali.get(id)!.status === 'done';
      } else {
        const hit = this.track.query(r.car.x, r.car.y, r.car.trackIndex);
        // Back onto the stretch of track the car was on (not whichever is nearest: at
        // Suzuka's crossover that could be the other road).
        const index = hit?.index ?? 0;
        const t = this.track.samples[index];
        r.car.place(t.x, t.y, Math.atan2(t.ty, t.tx), index);
        r.frozen = false;
      }
      r.car.repair();
      events.push({ kind: 'reset', racerId: id, note: 'Back on track' });
    }
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

