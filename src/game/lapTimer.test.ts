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

describe('LapTimer with real physics', () => {
  it('records clean laps for a careful driver on Silverstone', () => {
    const silverstone = new Track(TRACKS.silverstone);
    const ss = silverstone.samples;
    const n = ss.length;
    const car = new Car(F1_CAR, 'red');
    const start = ss[n - 10];
    car.place(start.x, start.y, Math.atan2(start.ty, start.tx));
    const timer = new LapTimer(silverstone);
    const laps = [];
    let now = 0;
    // Simple keyboard-style bot: aim ahead on the centreline, brake for upcoming corners.
    while (now < 300 && laps.length < 2) {
      const q = silverstone.query(car.x, car.y)!;
      const aim = ss[(q.index + Math.round((8 + car.speed * 0.3) / 2)) % n];
      let err = Math.atan2(aim.y - car.y, aim.x - car.x) - car.heading;
      err = Math.atan2(Math.sin(err), Math.cos(err));
      let k = 0;
      for (let j = 0; j < 80; j++) {
        const a = ss[(q.index + j) % n];
        const b = ss[(q.index + j + 4) % n];
        k = Math.max(k, Math.abs(Math.atan2(a.tx * b.ty - a.ty * b.tx, a.tx * b.tx + a.ty * b.ty)) / 8);
      }
      const limit = Math.sqrt(20 / Math.max(k, 1e-4));
      car.step(
        { throttle: car.speed < limit ? 1 : 0, brake: car.speed > limit + 4 ? 1 : 0, steer: err > 0.02 ? 1 : err < -0.02 ? -1 : 0 },
        DT,
        silverstone,
      );
      now += DT;
      for (const e of timer.update(now, DT, car)) if (e.kind === 'lap') laps.push(e.lap);
    }
    expect(car.retired).toBe(false);
    expect(laps).toHaveLength(2);
    for (const lap of laps) {
      expect(lap.valid).toBe(true);
      expect(lap.time).toBeGreaterThan(50);
      expect(lap.time).toBeLessThan(120);
    }
    expect(timer.trackLimitWarnings).toBe(0);
  });
});
