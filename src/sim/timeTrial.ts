import { F1_CAR } from '../physics/carParams';
import type { Track } from '../track/track';
import { racingLine, speedProfile } from './ai/racingLine';
import { GhostRecorder, type Ghost } from './ghost';
import { Tyres, type Compound } from './tyres';
import { RaceWorld, type PlayerInput, type Racer, type WorldEvent } from './world';

/** Everyone sets times on the same fresh tyres. */
export const TIME_TRIAL_COMPOUND: Compound = 'soft';
/** A restart puts the car between these distances (m) before the start line, already rolling. */
const RESTART_NEAREST = 60;
const RESTART_FURTHEST = 300;
/** Rolling restart speed: this share of the racing line's speed there, capped (m/s). */
const RESTART_PACE = 0.7;
const RESTART_MAX_SPEED = 45;

export interface TimeTrialLap {
  time: number;
  sectors: number[];
  ghost: Ghost;
}

/**
 * Time trial: one car alone on track, setting laps. A lap only counts if the car never has
 * all four wheels off the track (kerbs count as track) and stays out of the pit lane.
 * Every lap is set on the same terms: it starts from the same rolling start (the car goes
 * back there after each lap, so nobody carries speed out of the last corner), on fresh
 * tyres and a full ERS battery. DRS can be used in every zone.
 */
export class TimeTrial {
  readonly world: RaceWorld;
  readonly me: Racer;
  /** When the current lap was ruled out, or null while it still counts. */
  invalidAt: number | null = null;
  /** Why it was ruled out, for the driver. */
  invalidReason = '';
  /** Called for every valid lap. */
  onLap: (lap: TimeTrialLap) => void = () => {};
  private readonly recorder = new GhostRecorder();
  private lapStart: number | null = null;

  constructor(
    readonly track: Track,
    readonly trackId: string,
    name: string,
    color: string,
  ) {
    this.world = new RaceWorld(track, { drsRule: 'free', wetness: 0, slipstream: false, collisions: false });
    this.me = this.world.addRacer('me', name, color, TIME_TRIAL_COMPOUND);
    this.restart();
  }

  /** Back to just before the start line, rolling, repaired, on fresh tyres. */
  restart(): void {
    const { me, track } = this;
    const ss = track.samples;
    const i = restartIndex(track);
    const s = ss[i];
    const speed = Math.min(RESTART_MAX_SPEED, speedProfile(track, racingLine(track), F1_CAR, RESTART_PACE)[i]);
    me.car.place(s.x, s.y, Math.atan2(s.ty, s.tx), i);
    me.car.vx = s.tx * speed;
    me.car.vy = s.ty * speed;
    me.car.repair();
    // A clean track too: parts from the last crash would still be lying there for 30 s.
    this.world.debris = [];
    me.frozen = false;
    me.timer.abortLap();
    me.pit.phase = 'out';
    this.freshLap();
    this.lapStart = null;
    this.invalidAt = null;
  }

  /** Current lap time, if a lap is under way. */
  lapTime(): number | null {
    return this.me.timer.currentTime(this.world.time);
  }

  step(dt: number, input: PlayerInput): WorldEvent[] {
    const { me, world } = this;
    const events = world.step(dt, new Map([[me.id, input]]));
    let finished = false;
    for (const e of events) {
      if (e.kind !== 'lap' || e.racerId !== me.id) continue;
      finished = true;
      if (e.lap.valid && this.invalidAt === null) {
        this.onLap({ time: e.lap.time, sectors: e.lap.sectors, ghost: this.recorder.finish(this.trackId, me.name, e.lap.time) });
      }
    }
    // Lap over: back to the start for the next one.
    if (finished) {
      this.restart();
      return events;
    }
    const timer = me.timer;
    if (timer.lapStart !== this.lapStart) {
      // Crossed the line: a new lap, on the same terms as every other one.
      this.lapStart = timer.lapStart;
      this.recorder.start();
      this.invalidAt = null;
      if (timer.lapStart !== null) this.freshLap();
    }
    if (timer.lapStart === null) return events;
    this.recorder.add(world.time - timer.lapStart, me.car);
    // All four wheels off, or into the pits: the lap no longer counts.
    if (this.invalidAt === null && (timer.offTrack || me.pit.phase !== 'out')) {
      this.invalidAt = world.time;
      this.invalidReason = timer.offTrack ? 'all four wheels off track' : 'entered the pit lane';
      timer.valid = false;
    }
    return events;
  }

  private freshLap(): void {
    this.me.tyres = new Tyres(TIME_TRIAL_COMPOUND);
    this.me.ers = 1;
  }
}

/**
 * Where restarts begin: the straightest bit of the run to the line (so the car isn't put down
 * mid-corner at speed), preferring the nearest.
 */
export function restartIndex(track: Track): number {
  const ss = track.samples;
  const n = ss.length;
  const step = track.length / n;
  let best = 0;
  let bestScore = Infinity;
  for (let d = RESTART_NEAREST; d <= RESTART_FURTHEST; d += 10) {
    const i = (Math.round((track.length - d) / step) + n) % n;
    // How much the track turns in the 60 m after this point.
    let turn = 0;
    for (let k = 0; k < 60 / step; k++) turn += Math.abs(ss[(i + k) % n].curvature) * step;
    const score = turn + d * 0.0002;
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}
