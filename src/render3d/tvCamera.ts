import type { Track } from '../track/track';

/**
 * Broadcast cameras (looks only; no three.js here, so the game can load it without the 3D view):
 * the director for replays, cutting between trackside, helicopter and tracking shots, and the
 * fly-around of the circuit before a race.
 */

export interface Shot {
  eye: [number, number, number];
  look: [number, number, number];
  fov: number;
}

type HeightAt = (x: number, y: number, index?: number | null) => number;

type ShotKind = 'trackside' | 'heli' | 'tracking';
const SEQUENCE: ShotKind[] = ['trackside', 'heli', 'trackside', 'tracking'];

/** Longest each shot lasts (s). */
const SHOT_TIME: Record<ShotKind, number> = { trackside: 9, heli: 6, tracking: 4 };
const AHEAD_SAMPLES = 45;
const PAST = 35;

/** Field of view (deg) that keeps a car a fair size at this distance: a long lens from far off. */
export function zoomFor(distance: number): number {
  return Math.max(9, Math.min(55, (Math.atan2(7, Math.max(1, distance)) * 360) / Math.PI));
}

export class TvDirector {
  private next = 0;
  private kind: ShotKind | null = null;
  private time = 0;
  private spot: [number, number, number] = [0, 0, 0];
  private side = 1;

  constructor(
    private readonly track: Track,
    private readonly heightAt: HeightAt,
  ) {}

  /** Next frame starts a new shot. */
  cut(): void {
    this.kind = null;
  }

  step(x: number, y: number, heading: number, trackIndex: number | null | undefined, dt: number): Shot {
    this.time += dt;
    const ground = this.heightAt(x, y, trackIndex);
    if (this.kind === null || this.time > SHOT_TIME[this.kind] || this.passed(x, y, heading)) this.begin(x, y, trackIndex);
    const cos = Math.cos(heading);
    const sin = Math.sin(heading);
    const look: [number, number, number] = [x + cos * 2, ground + 0.8, y + sin * 2];
    switch (this.kind) {
      case 'heli': {
        // Hangs off to the side and drifts round the car.
        const a = 0.9 + this.time * 0.1;
        return { eye: [x - Math.cos(a) * 42 * this.side, ground + 30, y - Math.sin(a) * 42 * this.side], look, fov: 24 };
      }
      case 'tracking':
        return { eye: [x - cos * 5.5 - sin * 3.4 * this.side, ground + 0.75, y - sin * 5.5 + cos * 3.4 * this.side], look, fov: 58 };
      default: {
        const d = Math.hypot(this.spot[0] - x, this.spot[2] - y);
        return { eye: this.spot, look, fov: zoomFor(d) };
      }
    }
  }

  /** The car has gone by the trackside camera. */
  private passed(x: number, y: number, heading: number): boolean {
    if (this.kind !== 'trackside') return false;
    return (x - this.spot[0]) * Math.cos(heading) + (y - this.spot[2]) * Math.sin(heading) > PAST;
  }

  private begin(x: number, y: number, trackIndex: number | null | undefined): void {
    this.kind = SEQUENCE[this.next++ % SEQUENCE.length];
    this.time = 0;
    this.side = this.next % 4 < 2 ? 1 : -1;
    if (this.kind !== 'trackside') return;
    const n = this.track.samples.length;
    const here = this.track.query(x, y, trackIndex ?? null)?.index ?? 0;
    const s = this.track.samples[(here + AHEAD_SAMPLES) % n];
    // On the outside of the bend, off the road.
    const side = s.curvature > 0 ? -1 : 1;
    const off = side * Math.min((side > 0 ? s.wallR : s.wallL) + 1, s.halfWidth + 9);
    this.spot = [s.x + s.nx * off, this.heightAt(s.x, s.y) + 3.2, s.y + s.ny * off];
  }
}

/** One lap of the circuit from the air takes this long (s). */
const TOUR_TIME = 16;
const TOUR_HEIGHT = 48;
const TOUR_LOOK = 90;

/** The fly-around before a race: following the track from above, always looking down the road ahead. */
export function tourShot(track: Track, t: number, heightAt: HeightAt): Shot {
  const n = track.samples.length;
  const f = ((t / TOUR_TIME) % 1) * n;
  const i = Math.floor(f);
  const a = track.samples[i % n];
  const b = track.samples[(i + 1) % n];
  const w = f - i;
  const ahead = track.samples[(i + TOUR_LOOK) % n];
  const x = a.x + (b.x - a.x) * w;
  const y = a.y + (b.y - a.y) * w;
  return {
    eye: [x, heightAt(x, y) + TOUR_HEIGHT, y],
    look: [ahead.x, heightAt(ahead.x, ahead.y), ahead.y],
    fov: 62,
  };
}
