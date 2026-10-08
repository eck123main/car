import { describe, expect, it } from 'vitest';
import { Car } from '../physics/car';
import { F1_CAR } from '../physics/carParams';
import { Track } from '../track/track';
import { TRACKS } from '../tracks';
import { LapTimer, type TimingEvent } from './lapTimer';

const DT = 1 / 120;
const track = new Track(TRACKS.test);

/** Moves a car along the centreline (no physics) and feeds the timer. */
class Driver {
  readonly car = new Car(F1_CAR, 'red');
  readonly timer = new LapTimer(track);
  readonly events: TimingEvent[] = [];
  now = 0;
  s: number;

  constructor(startS: number) {
    this.s = startS;
    this.place(0);
  }

  /** Drive `distance` metres (negative = backwards) at `speed` m/s with a lateral offset. */
  drive(distance: number, speed: number, offset = 0): void {
    const steps = Math.ceil(Math.abs(distance) / (speed * DT));
    for (let i = 0; i < steps; i++) {
      this.s += distance / steps;
      this.place(offset);
      this.now += DT;
      this.events.push(...this.timer.update(this.now, DT, this.car));
    }
  }

  private place(offset: number): void {
    const L = track.length;
    const s = ((this.s % L) + L) % L;
    const n = track.samples.length;
    const f = s / 2;
    const a = track.samples[Math.floor(f) % n];
    const b = track.samples[(Math.floor(f) + 1) % n];
    const t = f - Math.floor(f);
    this.car.x = a.x + (b.x - a.x) * t + a.nx * offset;
    this.car.y = a.y + (b.y - a.y) * t + a.ny * offset;
    this.car.heading = Math.atan2(a.ty, a.tx);
  }

  laps() {
    return this.events.flatMap((e) => (e.kind === 'lap' ? [e.lap] : []));
  }
}

describe('LapTimer', () => {
  const L = track.length;

  it('times a flying lap after the out-lap, with sectors adding up', () => {
    const d = new Driver(L - 40);
    d.drive(40 + L + 10, 50);
    const laps = d.laps();
    expect(laps).toHaveLength(1);
    expect(laps[0].valid).toBe(true);
    expect(laps[0].time).toBeCloseTo(L / 50, 1);
    expect(laps[0].sectors).toHaveLength(3);
    expect(laps[0].sectors.reduce((a, b) => a + b, 0)).toBeCloseTo(laps[0].time, 5);
    for (const sector of laps[0].sectors) expect(sector).toBeCloseTo(L / 3 / 50, 1);
    expect(d.timer.bestLap?.time).toBeCloseTo(L / 50, 1);
  });

  it('does not count a lap from reversing back over the line', () => {
    const d = new Driver(L - 40);
    d.drive(60, 50); // cross the line: lap starts
    d.drive(-60, 5); // reverse back over it
    d.drive(60, 50); // and forwards again
    expect(d.laps()).toHaveLength(0);
  });

  it('deletes the lap when all four wheels leave the track', () => {
    const d = new Driver(L - 40);
    d.drive(140, 50);
    d.drive(30, 30, track.samples[0].halfWidth + 3); // fully off on the right
    d.drive(L - 100, 50);
    const trackLimits = d.events.filter((e) => e.kind === 'trackLimits');
    expect(trackLimits).toHaveLength(1);
    expect(d.timer.trackLimitWarnings).toBe(1);
    expect(d.laps()[0].valid).toBe(false);
    expect(d.timer.bestLap).toBeNull();
  });

  it('allows two wheels over the line', () => {
    const d = new Driver(L - 40);
    d.drive(140, 50);
    d.drive(30, 30, track.samples[0].halfWidth); // car centre on the white line
    d.drive(L - 100, 50);
    expect(d.timer.trackLimitWarnings).toBe(0);
    expect(d.laps()[0].valid).toBe(true);
  });

  it('turns the current lap into an out-lap after a reset', () => {
    const d = new Driver(L - 40);
    d.drive(500, 50);
    d.timer.abortLap();
    expect(d.timer.currentTime(d.now)).toBeNull();
    d.drive(L - 460 + 10, 50); // back over the line: new lap starts, nothing recorded
    expect(d.laps()).toHaveLength(0);
    expect(d.timer.currentTime(d.now)).not.toBeNull();
  });
});
