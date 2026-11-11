/**
 * Records every car for the replay of the last lap (looks only, on whatever machine is
 * watching). A ring per car, 20 times a second, so a long race never takes more memory.
 */

export interface ReplayCar {
  x: number;
  y: number;
  heading: number;
  steer: number;
  speed: number;
  brake: number;
  throttle: number;
  slip: number;
  yawRate: number;
  drs: boolean;
  ers: number;
  ersOn: boolean;
  lost: number;
  /** Which stretch of track it's on (for the road height where two cross). */
  trackIndex?: number | null;
  upset?: number;
  /** A car with its own gearbox: gear (0 = none) and revs (0-1). */
  gear?: number;
  revs?: number;
}

/** A moment worth seeing again. */
export interface Moment {
  time: number;
  id: string;
  score: number;
}

const FIELDS = 17;
const RATE = 20;
const SECONDS = 150;
/** A moment's clip starts this long before it (s). */
export const MOMENT_BEFORE = 3;
export const MOMENT_AFTER = 2.5;
/** Slow motion. */
export const MOMENT_SPEED = 0.4;

function pack(c: ReplayCar): number[] {
  return [c.x, c.y, c.heading, c.steer, c.speed, c.brake, c.throttle, c.slip, c.yawRate, c.drs ? 1 : 0, c.ers, c.ersOn ? 1 : 0, c.lost, c.trackIndex ?? -1, c.upset ?? 0, c.gear ?? 0, c.revs ?? 0];
}

export class ReplayRecorder {
  private readonly cap: number;
  private readonly tracks = new Map<string, Float32Array>();
  /** Time of tick 0, and how many ticks have been written (each tick has a slot in every ring). */
  private start: number | null = null;
  private ticks = 0;
  private readonly lapStarts = new Map<string, number[]>();
  private readonly laps = new Map<string, number>();
  private moments: Moment[] = [];

  constructor(private readonly rate = RATE, seconds = SECONDS) {
    this.cap = Math.round(rate * seconds);
  }

  private tickOf(time: number): number {
    return Math.floor((time - this.start!) * this.rate);
  }

  /** Record this moment, if a new tick is due. */
  record(time: number, cars: Iterable<[string, ReplayCar]>): void {
    if (this.start === null) this.start = time;
    const tick = this.tickOf(time);
    if (tick < this.ticks) return;
    for (const [id, car] of cars) {
      let ring = this.tracks.get(id);
      if (!ring) {
        ring = new Float32Array(this.cap * FIELDS).fill(NaN);
        this.tracks.set(id, ring);
      }
      const values = pack(car);
      // Long frames skip ticks: fill them, so the replay never reads an old lap's numbers.
      for (let t = Math.max(this.ticks, tick - this.cap + 1); t <= tick; t++) ring.set(values, (t % this.cap) * FIELDS);
    }
    this.ticks = tick + 1;
  }

  /** A car's lap count now (notes when each lap began). */
  noteLaps(time: number, id: string, laps: number): void {
    const before = this.laps.get(id);
    if (before !== undefined && laps > before) {
      const list = this.lapStarts.get(id) ?? [];
      list.push(time);
      this.lapStarts.set(id, list);
    }
    this.laps.set(id, laps);
  }

  /** Something happened worth a replay (an overtake, a big hit). Keeps the few best. */
  noteMoment(time: number, id: string, score: number): void {
    this.moments.push({ time, id, score });
    if (this.moments.length > 24) {
      this.moments.sort((a, b) => b.score - a.score);
      this.moments.length = 12;
    }
  }

  /** The best moment that can still be replayed; later ones win ties. */
  bestMoment(): Moment | null {
    const [from, to] = this.range;
    let best: Moment | null = null;
    for (const m of this.moments) {
      if (m.time - MOMENT_BEFORE < from || m.time > to) continue;
      if (!best || m.score >= best.score) best = m;
    }
    return best;
  }

  get hasData(): boolean {
    return this.ticks > 1;
  }

  /** Earliest and latest times that can be replayed. */
  get range(): [number, number] {
    const s = this.start ?? 0;
    return [s + Math.max(0, this.ticks - this.cap) / this.rate, s + (this.ticks - 1) / this.rate];
  }

  /**
   * When to start the replay of this car's last lap. Finished: the line crossing before the
   * final one. Otherwise, the latest crossing. Never before what is still kept.
   */
  lastLapStart(id: string, finished: boolean): number {
    const list = this.lapStarts.get(id) ?? [];
    const t = list[list.length - (finished ? 2 : 1)];
    const [from] = this.range;
    return t === undefined ? from : Math.max(from, t);
  }

  /** A car at this time, blended between ticks; null if it wasn't recorded then. */
  sample(id: string, time: number): ReplayCar | null {
    const ring = this.tracks.get(id);
    if (!ring || this.start === null) return null;
    const [from, to] = this.range;
    const t = Math.max(from, Math.min(to, time));
    const f = (t - this.start) * this.rate;
    const a = Math.floor(f);
    const b = Math.min(a + 1, this.ticks - 1);
    const w = f - a;
    const ia = (a % this.cap) * FIELDS;
    const ib = (b % this.cap) * FIELDS;
    if (Number.isNaN(ring[ia])) return null;
    const useB = !Number.isNaN(ring[ib]);
    const mix = (k: number) => (useB ? ring[ia + k] + (ring[ib + k] - ring[ia + k]) * w : ring[ia + k]);
    const dh = useB ? Math.atan2(Math.sin(ring[ib + 2] - ring[ia + 2]), Math.cos(ring[ib + 2] - ring[ia + 2])) : 0;
    // A reset teleports a car: don't sweep it across the map.
    const jumped = useB && Math.hypot(ring[ib] - ring[ia], ring[ib + 1] - ring[ia + 1]) > 30;
    return {
      x: jumped ? ring[ia] : mix(0),
      y: jumped ? ring[ia + 1] : mix(1),
      heading: ring[ia + 2] + dh * w,
      steer: mix(3),
      speed: mix(4),
      brake: mix(5),
      throttle: mix(6),
      slip: mix(7),
      yawRate: mix(8),
      drs: ring[ia + 9] > 0.5,
      ers: mix(10),
      ersOn: ring[ia + 11] > 0.5,
      lost: ring[ia + 12],
      trackIndex: ring[ia + 13] < 0 ? null : ring[ia + 13],
      upset: ring[ia + 14],
      gear: ring[ia + 15],
      revs: mix(16),
    };
  }
}
