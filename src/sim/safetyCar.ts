import { F1_CAR } from '../physics/carParams';
import type { Track } from '../track/track';
import { racingLine, speedProfile } from './ai/racingLine';

/** The safety car never goes faster than this (m/s, ~160 km/h)... */
export const SC_MAX_SPEED = 45;
/** ...and corners at this share of an F1 car's grip, so the field behind can keep up easily. */
const SC_PACE = 0.7;
const SC_ACCEL = 6;
const SC_BRAKE = 14;
/** With the leader further back than this (m), it slows to this speed (m/s) to let the field catch up. */
const WAIT_GAP = 120;
const WAIT_SPEED = 22;
/** Placed this far (m) ahead of the leader when it comes out. */
export const SC_LEAD = 150;
/**
 * Passing a car going slower than this (m/s, ~43 km/h) is allowed under the safety car: it has
 * stopped, spun or is limping back to the pits.
 */
export const SC_SLOW_CAR = 12;

/**
 * - deployed: lights on, no overtaking, the field queues up behind it.
 * - inThisLap: lights off, it pulls into the pit lane at the end of the lap.
 */
export type SafetyCarPhase = 'deployed' | 'inThisLap';

export interface SafetyCarSnap {
  phase: SafetyCarPhase;
  x: number;
  y: number;
  h: number;
}

const profiles = new WeakMap<Track, number[]>();

/** The safety car's planned speed at each track sample (it never exceeds SC_MAX_SPEED). */
export function safetyCarProfile(track: Track): number[] {
  let profile = profiles.get(track);
  if (!profile) profiles.set(track, (profile = speedProfile(track, racingLine(track), F1_CAR, SC_PACE)));
  return profile;
}

/**
 * The safety car: drives the racing line at a steady, easy pace. It is not a racer (no
 * physics, no collisions); it only sets the pace and marks where the queue must stay behind.
 */
export class SafetyCar {
  phase: SafetyCarPhase = 'deployed';
  /** Race distance, comparable with Session.progress (laps * length + lap distance). */
  progress: number;
  speed: number;
  x = 0;
  y = 0;
  heading = 0;
  prevX = 0;
  prevY = 0;
  prevHeading = 0;
  private readonly profile: number[];

  constructor(
    private readonly track: Track,
    progress: number,
    readonly deployedAt: number,
  ) {
    this.progress = progress;
    this.profile = safetyCarProfile(track);
    this.speed = Math.min(SC_MAX_SPEED, this.profile[this.index(0)]);
    this.place();
    this.prevX = this.x;
    this.prevY = this.y;
    this.prevHeading = this.heading;
  }

  /** Distance into the lap (m). */
  get s(): number {
    const L = this.track.length;
    return ((this.progress % L) + L) % L;
  }

  /** Move on. `leaderGap`: how far back (m) the first car behind it is, so it can wait for the field. */
  step(dt: number, leaderGap = 0): void {
    this.prevX = this.x;
    this.prevY = this.y;
    this.prevHeading = this.heading;
    // The plan already brakes gently for each corner, so just follow it.
    let target = Math.min(SC_MAX_SPEED, this.profile[this.index(0)]);
    if (leaderGap > WAIT_GAP) target = Math.min(target, WAIT_SPEED);
    if (this.speed < target) this.speed = Math.min(target, this.speed + SC_ACCEL * dt);
    else this.speed = Math.max(target, this.speed - SC_BRAKE * dt);
    this.progress += this.speed * dt;
    this.place();
  }

  snap(): SafetyCarSnap {
    return { phase: this.phase, x: this.x, y: this.y, h: this.heading };
  }

  private index(offset: number): number {
    const n = this.track.samples.length;
    return (Math.floor(this.s / 2) + offset) % n;
  }

  /** On the racing line at the current distance, pointing along it. */
  private place(): void {
    const ss = this.track.samples;
    const n = ss.length;
    const line = racingLine(this.track);
    const f = this.s / 2;
    const i = Math.floor(f) % n;
    const j = (i + 1) % n;
    const t = f - Math.floor(f);
    const ax = ss[i].x + ss[i].nx * line.offset[i];
    const ay = ss[i].y + ss[i].ny * line.offset[i];
    const bx = ss[j].x + ss[j].nx * line.offset[j];
    const by = ss[j].y + ss[j].ny * line.offset[j];
    this.x = ax + (bx - ax) * t;
    this.y = ay + (by - ay) * t;
    this.heading = Math.atan2(by - ay, bx - ax);
  }
}
