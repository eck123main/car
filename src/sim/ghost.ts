import type { Car } from '../physics/car';
import type { Track } from '../track/track';

/** Ghost samples per second of lap time. */
const GHOST_RATE = 20;

/**
 * A recorded lap: the car's position and heading every 1/20 s from the moment it crossed the
 * start line. Replayed next to a driver as a see-through car to race against.
 */
export interface Ghost {
  track: string;
  name: string;
  /** Lap time (s). */
  time: number;
  /** Seconds between samples. */
  dt: number;
  x: number[];
  y: number[];
  h: number[];
}

export interface GhostPose {
  x: number;
  y: number;
  heading: number;
}

/** Records one lap at a time. */
export class GhostRecorder {
  private x: number[] = [];
  private y: number[] = [];
  private h: number[] = [];

  /** Start a new lap (drops whatever was recorded). */
  start(): void {
    this.x = [];
    this.y = [];
    this.h = [];
  }

  /** Call every step with the time into the lap; keeps one sample per 1/20 s. */
  add(lapTime: number, car: Car): void {
    while (this.x.length <= lapTime * GHOST_RATE) {
      this.x.push(Math.round(car.x * 20) / 20);
      this.y.push(Math.round(car.y * 20) / 20);
      this.h.push(Math.round(car.heading * 1000) / 1000);
    }
  }

  finish(track: string, name: string, time: number): Ghost {
    return { track, name, time, dt: 1 / GHOST_RATE, x: this.x, y: this.y, h: this.h };
  }
}

/** Where the ghost is `t` seconds into its lap (null before the start or after the finish). */
export function ghostPose(g: Ghost, t: number): GhostPose | null {
  if (t < 0 || t > g.time || g.x.length === 0) return null;
  const f = t / g.dt;
  const i = Math.min(Math.floor(f), g.x.length - 1);
  const j = Math.min(i + 1, g.x.length - 1);
  const a = f - i;
  const dh = Math.atan2(Math.sin(g.h[j] - g.h[i]), Math.cos(g.h[j] - g.h[i]));
  return { x: g.x[i] + (g.x[j] - g.x[i]) * a, y: g.y[i] + (g.y[j] - g.y[i]) * a, heading: g.h[i] + dh * a };
}

/** Resolution of a ghost's distance trace (m). */
const TRACE_BUCKET = 10;

/**
 * When the ghost first reached each 10 m of the lap, for a live gap to it: `trace[b]` is the
 * lap time at distance b * 10 m.
 */
export function ghostTrace(g: Ghost, track: Track): number[] {
  const trace: number[] = [];
  let hint: number | null = null;
  for (let i = 0; i < g.x.length; i++) {
    const q = track.query(g.x[i], g.y[i], hint);
    if (!q) continue;
    hint = q.index;
    // Just after the line the car is near s = 0; a sample before it reads as nearly a full lap.
    const s = q.s > track.length / 2 && i * g.dt < 10 ? 0 : q.s;
    const b = Math.floor(s / TRACE_BUCKET);
    // Fill every bucket up to here (fast cars skip some between samples).
    for (let k = trace.length; k <= b; k++) trace[k] = i * g.dt;
  }
  return trace;
}

/** Time gained (negative) or lost against a ghost trace at lap distance s. */
export function ghostDelta(trace: number[], lapTime: number, s: number): number | null {
  const ref = trace[Math.floor(s / TRACE_BUCKET)];
  return ref === undefined ? null : lapTime - ref;
}

/** A ghost loaded from storage or the network: is it well formed? */
export function isGhost(v: unknown): v is Ghost {
  const g = v as Ghost;
  return (
    typeof g === 'object' &&
    g !== null &&
    typeof g.time === 'number' &&
    typeof g.dt === 'number' &&
    g.dt > 0 &&
    Array.isArray(g.x) &&
    Array.isArray(g.y) &&
    Array.isArray(g.h) &&
    g.x.length === g.y.length &&
    g.x.length === g.h.length
  );
}
