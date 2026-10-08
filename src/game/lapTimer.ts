import type { Car } from '../physics/car';
import { KERB_WIDTH, type Track, type TrackSample } from '../track/track';

export const SECTOR_COUNT = 3;
/** Wheels may go this far past the track edge before it counts as off track (m). */
const LIMITS_TOLERANCE = 1;
/** Back on track for this long before another excursion counts as a new warning. */
const REARM_TIME = 0.5;
/** Progress jumps bigger than this (m) in one step are resets, not driving. */
const MAX_STEP_DISTANCE = 30;
/** Resolution of the best-lap trace used for the live delta (m). */
const DELTA_BUCKET = 10;

export interface LapRecord {
  time: number;
  sectors: number[];
  valid: boolean;
}

/** Everything the HUD needs from a timer, for sending over the network. */
export interface TimerState {
  lapsCompleted: number;
  lapStart: number | null;
  sectors: number[];
  valid: boolean;
  lastLap: LapRecord | null;
  bestLap: LapRecord | null;
  bestSectors: (number | null)[];
  trackLimitWarnings: number;
  offTrack: boolean;
  s: number | null;
}

export type TimingEvent =
  | { kind: 'lap'; lap: LapRecord; personalBest: boolean }
  | { kind: 'trackLimits'; warnings: number; lapDeleted: boolean };

/**
 * Lap and sector timing plus track limits for one car. Driven by simulation time,
 * so it gives the same result on every machine.
 *
 * A lap only counts when the car passes every sector line in order, so reversing
 * over the start line or resetting can't fake a lap.
 */
export class LapTimer {
  /** Completed laps (valid or not). */
  lapsCompleted = 0;
  /** Simulation time the current lap started, or null on an out-lap. */
  lapStart: number | null = null;
  /** Sector times so far this lap. */
  sectors: number[] = [];
  valid = true;

  lastLap: LapRecord | null = null;
  bestLap: LapRecord | null = null;
  bestSectors: (number | null)[] = new Array(SECTOR_COUNT).fill(null);

  trackLimitWarnings = 0;
  /** True while all four wheels are beyond the white lines. */
  offTrack = false;

  private readonly sectorEnds: number[];
  private nextCheckpoint = 0;
  private sectorStart = 0;
  private prevS: number | null = null;
  private armed = true;
  private onTrackFor = 0;
  private currentTrace: number[] = [];
  private bestTrace: number[] | null = null;

  constructor(private readonly track: Track) {
    // Sector lines split the lap into equal thirds; the last one is the finish line.
    this.sectorEnds = Array.from({ length: SECTOR_COUNT }, (_, i) => (track.length * (i + 1)) / SECTOR_COUNT);
  }

  snapshot(): TimerState {
    return {
      lapsCompleted: this.lapsCompleted,
      lapStart: this.lapStart,
      sectors: this.sectors,
      valid: this.valid,
      lastLap: this.lastLap,
      bestLap: this.bestLap,
      bestSectors: this.bestSectors,
      trackLimitWarnings: this.trackLimitWarnings,
      offTrack: this.offTrack,
      s: this.prevS,
    };
  }

  /** Mirror a timer from the host (clients only display it, they never time laps). */
  restore(st: TimerState): void {
    this.lapsCompleted = st.lapsCompleted;
    this.lapStart = st.lapStart;
    this.sectors = st.sectors;
    this.valid = st.valid;
    this.lastLap = st.lastLap;
    this.bestLap = st.bestLap;
    this.bestSectors = st.bestSectors;
    this.trackLimitWarnings = st.trackLimitWarnings;
    this.offTrack = st.offTrack;
    this.prevS = st.s;
  }

  /** The car's distance along the lap (m) at the last update, if known. */
  get lapDistance(): number | null {
    return this.prevS;
  }

  /** Current lap time, or null on an out-lap. */
  currentTime(now: number): number | null {
    return this.lapStart === null ? null : now - this.lapStart;
  }

  /** Time gained (negative) or lost against the best lap at this point, if known. */
  delta(now: number): number | null {
    if (this.lapStart === null || !this.bestTrace || this.prevS === null) return null;
    const ref = this.bestTrace[Math.floor(this.prevS / DELTA_BUCKET)];
    return ref === undefined ? null : now - this.lapStart - ref;
  }

  /** Call after a reset/teleport: the current lap no longer counts. */
  abortLap(): void {
    this.lapStart = null;
    this.sectors = [];
    this.nextCheckpoint = 0;
    this.prevS = null;
    this.valid = true;
  }

  /** Call once per physics step, after the car has moved. Returns anything worth telling the driver. */
  update(now: number, dt: number, car: Car): TimingEvent[] {
    const events: TimingEvent[] = [];
    const hit = this.track.query(car.x, car.y);
    if (hit) {
      const s = hit.s;
      if (this.prevS !== null) this.checkCrossings(this.prevS, s, now, dt, events);
      this.prevS = s;
      if (this.lapStart !== null) {
        const bucket = Math.floor(s / DELTA_BUCKET);
        if (this.currentTrace[bucket] === undefined) this.currentTrace[bucket] = now - this.lapStart;
      }
    }
    this.checkTrackLimits(dt, car, events);
    return events;
  }

  private checkCrossings(prevS: number, s: number, now: number, dt: number, events: TimingEvent[]): void {
    const L = this.track.length;
    // Forward distance travelled, allowing for the wrap at the start line.
    let ds = s - prevS;
    if (ds < -L / 2) ds += L;
    else if (ds > L / 2) ds -= L;
    if (ds <= 0 || ds > MAX_STEP_DISTANCE) return;

    const target = this.sectorEnds[this.nextCheckpoint];
    const isFinish = this.nextCheckpoint === SECTOR_COUNT - 1;
    // Distance from prevS forward to the checkpoint line.
    let toLine = (isFinish ? L : target) - prevS;
    if (isFinish && toLine > L / 2) toLine -= L;
    if (toLine <= 0 || toLine > ds) {
      // Before the first lap starts, the finish line is the only line that matters.
      if (this.lapStart === null) this.maybeStartLap(prevS, ds, now, dt);
      return;
    }
    const crossTime = now - dt + dt * (toLine / ds);
    if (this.lapStart === null) {
      this.maybeStartLap(prevS, ds, now, dt);
      return;
    }

    const sectorTime = crossTime - this.sectorStart;
    this.sectors.push(sectorTime);
    this.sectorStart = crossTime;
    if (!isFinish) {
      this.nextCheckpoint++;
      return;
    }

    const lap: LapRecord = { time: crossTime - this.lapStart, sectors: this.sectors, valid: this.valid };
    this.lapsCompleted++;
    this.lastLap = lap;
    let personalBest = false;
    if (lap.valid) {
      lap.sectors.forEach((t, i) => {
        const best = this.bestSectors[i];
        if (best === null || t < best) this.bestSectors[i] = t;
      });
      if (!this.bestLap || lap.time < this.bestLap.time) {
        this.bestLap = lap;
        this.bestTrace = this.currentTrace;
        personalBest = true;
      }
    }
    events.push({ kind: 'lap', lap, personalBest });
    this.beginLap(crossTime);
  }

  /** On an out-lap: start timing when the car crosses the start line going forwards. */
  private maybeStartLap(prevS: number, ds: number, now: number, dt: number): void {
    const L = this.track.length;
    let toLine = L - prevS;
    if (toLine > L / 2) toLine -= L;
    if (toLine > 0 && toLine <= ds) this.beginLap(now - dt + dt * (toLine / ds));
  }

  private beginLap(start: number): void {
    this.lapStart = start;
    this.sectorStart = start;
    this.sectors = [];
    this.nextCheckpoint = 0;
    this.valid = true;
    this.currentTrace = [];
  }

  /** Off track when all four wheels are beyond the track edge (kerbs count as track). */
  private checkTrackLimits(dt: number, car: Car, events: TimingEvent[]): void {
    const p = car.params;
    const c = Math.cos(car.heading);
    const s = Math.sin(car.heading);
    const half = p.width / 2 - 0.2;
    let anyWheelOn = false;
    for (const lx of [p.cgToFront, -p.cgToRear]) {
      for (const ly of [-half, half]) {
        const hit = this.track.query(car.x + c * lx - s * ly, car.y + s * lx + c * ly);
        if (hit && Math.abs(hit.d) <= trackEdge(this.track, hit.sample, hit.d) + LIMITS_TOLERANCE) anyWheelOn = true;
      }
    }
    this.offTrack = !anyWheelOn;
    if (anyWheelOn) {
      this.onTrackFor += dt;
      if (this.onTrackFor >= REARM_TIME) this.armed = true;
      return;
    }
    this.onTrackFor = 0;
    if (!this.armed) return;
    this.armed = false;
    this.trackLimitWarnings++;
    const lapDeleted = this.lapStart !== null && this.valid;
    if (this.lapStart !== null) this.valid = false;
    events.push({ kind: 'trackLimits', warnings: this.trackLimitWarnings, lapDeleted });
  }
}

/** Where the track ends on the side of offset d: the white line, a kerb's outer edge, or the pit lane. */
function trackEdge(track: Track, sample: TrackSample, d: number): number {
  if (track.onPitSide(sample, d)) return sample.halfWidth + sample.pitWidth;
  const kerb = d >= 0 ? sample.kerbR : sample.kerbL;
  return sample.halfWidth + (kerb ? KERB_WIDTH : 0);
}
