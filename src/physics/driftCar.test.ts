import { describe, expect, it } from 'vitest';
import { BotDriver } from '../sim/ai/botDriver';
import { CAR_CLASSES } from '../sim/carClass';
import { TimeTrial } from '../sim/timeTrial';
import { Track } from '../track/track';
import { TRACKS } from '../tracks';
import { Car, type CarWorld, type DriverInput } from './car';
import { DRIFT_CAR, GT3_CAR, type CarParams } from './carParams';

const DT = 1 / 120;
const asphalt = { type: 'asphalt', grip: 1, drag: 0, dragPerSpeed: 0 };
const flat = { surfaceAt: () => asphalt, wallContact: () => null } as unknown as CarWorld;

/** Angle between where the nose points and where the car is going (degrees). */
function slide(car: Car): number {
  const c = Math.cos(car.heading);
  const s = Math.sin(car.heading);
  return (Math.atan2(-car.vx * s + car.vy * c, car.vx * c + car.vy * s) * 180) / Math.PI;
}

/** Drives each phase in turn; the biggest slide seen and the slide at the end of each phase. */
function run(params: CarParams, kmh: number, phases: [number, DriverInput][]): { max: number; ends: number[] } {
  const car = new Car(params, 'red');
  car.vx = kmh / 3.6;
  let max = 0;
  const ends: number[] = [];
  for (const [seconds, input] of phases) {
    for (let t = 0; t < seconds; t += DT) {
      car.step(input, DT, flat);
      max = Math.max(max, Math.abs(slide(car)));
    }
    ends.push(Math.abs(slide(car)));
  }
  return { max, ends };
}

const power: DriverInput = { throttle: 1, brake: 0, steer: 1 };

describe('Drift car', () => {
  it('slides into a big power drift on keys with TC low or off, with the assist, and never spins', () => {
    // Held flat out at full lock it swings between drift and grip (a driver would feather it).
    for (const tc of [0, 1]) {
      const car = new Car(DRIFT_CAR, 'red');
      car.vx = 60 / 3.6;
      let max = 0;
      let sum = 0;
      let n = 0;
      for (let t = 0; t < 6; t += DT) {
        car.step({ ...power, tc }, DT, flat);
        max = Math.max(max, Math.abs(slide(car)));
        if (t > 1) {
          sum += Math.abs(slide(car));
          n++;
        }
      }
      expect(max, `tc ${tc}`).toBeGreaterThan(tc === 0 ? 30 : 24);
      expect(max, `tc ${tc}`).toBeLessThan(65);
      expect(sum / n, `tc ${tc}`).toBeGreaterThan(10);
    }
  });

  it('with TC high it only slides a little, so it can be driven on keys', () => {
    // Every tap of a key is full lock: the assist keeps it near a grip car (players found it hard).
    const car = new Car(DRIFT_CAR, 'red');
    car.vx = 60 / 3.6;
    let max = 0;
    for (let t = 0; t < 6; t += DT) {
      car.step({ ...power, tc: 2 }, DT, flat);
      max = Math.max(max, Math.abs(slide(car)));
    }
    expect(max).toBeLessThan(25);
  });

  it('straightens up when the keys are let go, without snapping the other way', () => {
    const car = new Car(DRIFT_CAR, 'red');
    car.vx = 70 / 3.6;
    for (let t = 0; t < 3; t += DT) car.step({ ...power, tc: 0 }, DT, flat);
    const held = slide(car);
    expect(Math.abs(held)).toBeGreaterThan(20);
    let other = 0;
    for (let t = 0; t < 2.5; t += DT) {
      car.step({ throttle: 0.6, brake: 0, steer: 0, tc: 0 }, DT, flat);
      other = Math.max(other, Math.sign(-held) * slide(car));
    }
    expect(other).toBeLessThan(15);
    expect(Math.abs(slide(car))).toBeLessThan(10);
  });

  it('kicks the tail out on the handbrake, which a GT3 does not have', () => {
    const hand = (p: CarParams) => run(p, 90, [[0.5, { throttle: 0, brake: 0, steer: 1, handbrake: true }]]).ends[0];
    expect(hand(DRIFT_CAR)).toBeGreaterThan(12);
    expect(hand(GT3_CAR)).toBeLessThan(10);
    // Then on the power it drifts, still without a spin.
    const { max } = run(DRIFT_CAR, 90, [
      [0.5, { throttle: 0, brake: 0, steer: 1, handbrake: true }],
      [2, { ...power, throttle: 0.8 }],
    ]);
    expect(max).toBeLessThan(65);
  });

  it('a handbrake stop with the wheel straight stays straight', () => {
    const { max } = run(DRIFT_CAR, 80, [[1.5, { throttle: 0, brake: 0, steer: 0, handbrake: true }]]);
    expect(max).toBeLessThan(5);
  });

  it('with the assist off it can spin', () => {
    const { max } = run(DRIFT_CAR, 60, [[4, { ...power, tc: 0, assist: false }]]);
    expect(max).toBeGreaterThan(80);
  });

  it('bots never pull the handbrake (it is the DRS key)', () => {
    const track = new Track(TRACKS.silverstone);
    const tt = new TimeTrial(track, 'x', 'Bot', 'red', 'drift');
    const bot = new BotDriver(track, 'me', 'hard', DRIFT_CAR);
    const input = bot.drive(tt.world, { phase: 'practice', raceStart: 0, laps: null, mandatoryStop: false }, DT);
    expect(input.drs).toBe(false);
    expect(CAR_CLASSES.drift.handbrake).toBe(true);
  });

  it('bots drive clean laps in it, slower than the GT3', () => {
    for (const id of ['silverstone', 'monaco', 'spa', 'suzuka', 'baku', 'interlagos']) {
      const lap = (cls: 'gt3' | 'drift') => {
        const track = new Track(TRACKS[id]);
        const tt = new TimeTrial(track, id, 'Bot', 'red', cls);
        const bot = new BotDriver(track, 'me', 'hard', CAR_CLASSES[cls].params);
        let time: number | null = null;
        tt.onLap = (l) => (time = l.time);
        for (let t = 0; t < 300 && time === null; t += DT) tt.step(DT, bot.drive(tt.world, { phase: 'practice', raceStart: 0, laps: null, mandatoryStop: false }, DT));
        return time as number | null;
      };
      const drift = lap('drift');
      expect(drift, id).not.toBeNull();
      expect(drift!, id).toBeGreaterThan(lap('gt3')!);
    }
  }, 300_000);
});
