import { describe, expect, it } from 'vitest';
import { BotDriver } from '../sim/ai/botDriver';
import { CAR_CLASSES } from '../sim/carClass';
import { TimeTrial } from '../sim/timeTrial';
import { Track } from '../track/track';
import { TRACKS } from '../tracks';
import { Car, enginePower, slipForShare, tyreCurve, type CarWorld, type DriverInput } from './car';
import { GT3_CAR } from './carParams';
import { SURFACES } from '../track/types';

const DT = 1 / 120;
const G = 9.81;
const asphalt = { type: 'asphalt', grip: 1, drag: 0, dragPerSpeed: 0 };
const flat = { surfaceAt: () => asphalt, wallContact: () => null } as unknown as CarWorld;
const none: DriverInput = { throttle: 0, brake: 0, steer: 0 };

function drive(car: Car, input: DriverInput, seconds: number, world = flat): void {
  for (let t = 0; t < seconds; t += DT) car.step(input, DT, world);
}

function timeUntil(car: Car, input: DriverInput, done: () => boolean): number {
  let t = 0;
  while (!done() && t < 200) {
    car.step(input, DT, flat);
    t += DT;
  }
  return t;
}

function moving(kmh: number): Car {
  const car = new Car(GT3_CAR, 'red');
  car.vx = kmh / 3.6;
  return car;
}

/** Angle between where the nose points and where the car is going. */
function slide(car: Car): number {
  const c = Math.cos(car.heading);
  const s = Math.sin(car.heading);
  return Math.atan2(-car.vx * s + car.vy * c, car.vx * c + car.vy * s);
}

/** Settle into a steady corner at this speed and steering. */
function corner(kmh: number, steer: number): Car {
  const car = moving(kmh);
  const v = kmh / 3.6;
  for (let t = 0; t < 4; t += DT) {
    car.step({ ...none, throttle: 0.3, steer }, DT, flat);
    const k = v / car.speed;
    car.vx *= k;
    car.vy *= k;
  }
  return car;
}

describe('GT3 performance against the real cars', () => {
  it('accelerates like one', () => {
    const car = new Car(GT3_CAR, 'red');
    const full = { ...none, throttle: 1 };
    const to100 = timeUntil(car, full, () => car.speed >= 100 / 3.6);
    const to200 = to100 + timeUntil(car, full, () => car.speed >= 200 / 3.6);
    expect(to100).toBeGreaterThan(3);
    expect(to100).toBeLessThan(4.2);
    expect(to200).toBeGreaterThan(8);
    expect(to200).toBeLessThan(11);
  });

  it('tops out near 290-300 km/h in top gear', () => {
    const car = new Car(GT3_CAR, 'red');
    drive(car, { ...none, throttle: 1 }, 120);
    expect(car.speed * 3.6).toBeGreaterThan(280);
    expect(car.speed * 3.6).toBeLessThan(310);
    expect(car.gear).toBe(GT3_CAR.dynamics!.gears.length);
  });

  it('stops from 200 km/h in about 90-120 m, in a straight line', () => {
    const car = moving(200);
    timeUntil(car, { ...none, brake: 1 }, () => car.speed < 1);
    expect(car.x).toBeGreaterThan(80);
    expect(car.x).toBeLessThan(125);
    expect(Math.abs(car.y)).toBeLessThan(0.1);
  });

  it('corners at 1.5 g slowly and around 2 g with downforce at 250 km/h', () => {
    const lateral = (kmh: number) => ((kmh / 3.6) * Math.abs(corner(kmh, 1).yawRate)) / G;
    expect(lateral(70)).toBeGreaterThan(1.35);
    expect(lateral(70)).toBeLessThan(1.7);
    expect(lateral(250)).toBeGreaterThan(1.8);
    expect(lateral(250)).toBeLessThan(2.3);
  });

  it('changes gear through all six on the way up and comes back down', () => {
    const car = new Car(GT3_CAR, 'red');
    const seen = new Set<number>();
    for (let t = 0; t < 40; t += DT) {
      car.step({ ...none, throttle: 1 }, DT, flat);
      seen.add(car.gear);
    }
    expect([...seen].sort()).toEqual([1, 2, 3, 4, 5, 6]);
    timeUntil(car, { ...none, brake: 1 }, () => car.speed < 8);
    expect(car.gear).toBe(1);
  });

  it('makes its most power just under the limiter', () => {
    expect(enginePower(0.92)).toBe(1);
    expect(enginePower(0.75)).toBeGreaterThan(0.9);
    expect(enginePower(1)).toBeLessThan(1);
    expect(enginePower(0.4)).toBeLessThan(0.7);
  });
});

describe('GT3 handling', () => {
  it('has a tyre that peaks and then gives up some grip', () => {
    expect(tyreCurve(1, 0.9)).toBeCloseTo(1);
    expect(tyreCurve(0.5, 0.9)).toBeLessThan(1);
    expect(tyreCurve(3, 0.9)).toBeCloseTo(0.9);
    for (const u of [0.2, 0.6, 0.95]) expect(tyreCurve(slipForShare(u), 0.9)).toBeCloseTo(u);
  });

  it('understeers at the limit, as these cars are set up to', () => {
    // The front tyres work harder than the rears: going too fast pushes wide, no spin.
    const car = moving(150);
    let worst = 0;
    for (let t = 0; t < 3; t += DT) {
      car.step({ ...none, throttle: 0.4, steer: 1 }, DT, flat);
      worst = Math.max(worst, Math.abs(slide(car)));
    }
    expect(worst).toBeLessThan(0.15);
  });

  it('rotates when you lift in a fast corner', () => {
    const held = corner(160, 0.8);
    const lifted = corner(160, 0.8);
    const before = held.yawRate;
    drive(held, { ...none, throttle: 0.3, steer: 0.8 }, 0.25);
    drive(lifted, { ...none, steer: 0.8 }, 0.25);
    expect(lifted.yawRate).toBeGreaterThan(held.yawRate);
    expect(lifted.yawRate).toBeGreaterThan(before);
  });

  it('moves weight forward under braking: more front grip, a lighter rear', () => {
    const car = moving(200);
    drive(car, { ...none, brake: 1 }, 0.6);
    expect(car.longG).toBeLessThan(-1.2);
    expect(car.sliding).toBe(false);
  });

  it('turns less while braking hard than while coasting', () => {
    const braking = moving(180);
    const coasting = moving(180);
    drive(braking, { ...none, brake: 1, steer: 1 }, 0.5);
    drive(coasting, { ...none, steer: 1 }, 0.5);
    expect(Math.abs(braking.heading)).toBeLessThan(Math.abs(coasting.heading));
    expect(Math.abs(slide(braking))).toBeLessThan(0.3);
  });

  it('traction control keeps full power out of a slow corner from spinning it', () => {
    const car = corner(70, 0.9);
    let worst = 0;
    for (let t = 0; t < 2; t += DT) {
      car.step({ ...none, throttle: 1, steer: 0.9 }, DT, flat);
      worst = Math.max(worst, Math.abs(slide(car)));
    }
    expect(worst).toBeLessThan(0.25);
  });

  it('steps out with the rear on grass, and is caught', () => {
    const grass = { type: 'grass', grip: 0.35, drag: 0, dragPerSpeed: 0 };
    const car = moving(150);
    // Only the rear axle is on the grass.
    const world = {
      surfaceAt: (x: number, y: number) => ((x - car.x) * Math.cos(car.heading) + (y - car.y) * Math.sin(car.heading) < 0 ? grass : asphalt),
      wallContact: () => null,
    } as unknown as CarWorld;
    let worst = 0;
    for (let t = 0; t < 2; t += DT) {
      car.step({ ...none, throttle: 1, steer: 0.9 }, DT, world);
      worst = Math.max(worst, Math.abs(slide(car)));
    }
    expect(worst).toBeGreaterThan(0.08);
    expect(worst).toBeLessThan(0.35);
  });

  /** The worst slide (rad) while moving, over a run of held keys: [seconds, keys]. */
  function worstSlide(kmh: number, keys: [number, Partial<DriverInput>][], rearGrip = 1, gripFactor = 1): number {
    const car = moving(kmh);
    car.gripFactor = gripFactor;
    const rear = { ...asphalt, grip: rearGrip };
    const world = {
      surfaceAt: (x: number, y: number) => ((x - car.x) * Math.cos(car.heading) + (y - car.y) * Math.sin(car.heading) < 0 ? rear : asphalt),
      wallContact: () => null,
    } as unknown as CarWorld;
    let worst = 0;
    for (const [seconds, input] of keys) {
      for (let t = 0; t < seconds; t += DT) {
        car.step({ ...none, ...input }, DT, world);
        if (car.forwardSpeed > 8) worst = Math.max(worst, Math.abs(slide(car)));
      }
    }
    return worst;
  }

  it('never spins from the keys alone: braking, lifting and flooring it with full lock held', () => {
    // What a keyboard does into, through and out of every corner. It used to swap ends.
    const left = { steer: -1 };
    const right = { steer: 1 };
    const runs: [number, Partial<DriverInput>][][] = [
      [[3, { ...right, brake: 1 }]],
      [[0.5, { brake: 1 }], [2.5, { ...right, brake: 1 }]],
      [[1, { ...right, throttle: 1 }], [2, { ...right, brake: 1 }]],
      [[1, { ...right, brake: 1 }], [1, right], [2, { ...right, throttle: 1 }]],
      [[0.7, { ...left, brake: 1 }], [0.7, { ...right, brake: 1 }], [2, { ...right, throttle: 1 }]],
      [[1, left], [1, right], [2, {}]],
      [[4, right]],
      [[4, { ...right, throttle: 1 }]],
    ];
    // Dry, worn tyres, slicks in the wet, the rear wheels on a kerb and on the grass.
    const roads: [number, number][] = [[1, 1], [1, 0.85], [1, 0.55], [0.95, 1], [0.7, 1]];
    for (const [rearGrip, gripFactor] of roads) {
      for (const kmh of [90, 120, 160, 200, 250]) {
        for (const keys of runs) expect(worstSlide(kmh, keys, rearGrip, gripFactor)).toBeLessThan(0.3);
      }
    }
  });

  it('still turns in on the brakes', () => {
    const car = moving(160);
    drive(car, { ...none, brake: 1, steer: 1 }, 1);
    expect(Math.abs(car.heading)).toBeGreaterThan(0.25);
  });

  it('can still be lost: a hard hit spins it', () => {
    const car = moving(150);
    car.yawRate = 3;
    car.upset = 1;
    let worst = 0;
    for (let t = 0; t < 3; t += DT) {
      car.step({ ...none, throttle: 0.5 }, DT, flat);
      worst = Math.max(worst, Math.abs(slide(car)));
    }
    expect(worst).toBeGreaterThan(1);
  });

  it('pulls away briskly from a standstill even at full lock', () => {
    const car = new Car(GT3_CAR, 'red');
    drive(car, { ...none, throttle: 1, steer: 1 }, 1.5);
    expect(car.speed * 3.6).toBeGreaterThan(25);
  });

  it('can always drive out of the gravel', () => {
    const gravel = { surfaceAt: () => SURFACES.gravel, wallContact: () => null } as unknown as CarWorld;
    const car = new Car(GT3_CAR, 'red');
    drive(car, { ...none, throttle: 1 }, 8, gravel);
    expect(car.speed * 3.6).toBeGreaterThan(25);
  });

  it('holds a straight line flat out with no wobble', () => {
    const car = moving(280);
    drive(car, { ...none, throttle: 1 }, 5);
    expect(Math.abs(car.heading)).toBeLessThan(1e-6);
    expect(Math.abs(car.yawRate)).toBeLessThan(1e-6);
  });

  it('settles after a flick of the steering at speed', () => {
    const car = moving(220);
    drive(car, { ...none, throttle: 1, steer: 1 }, 0.2);
    drive(car, { ...none, throttle: 1, steer: -1 }, 0.2);
    drive(car, { ...none, throttle: 1 }, 2);
    expect(Math.abs(car.yawRate)).toBeLessThan(0.02);
    expect(Math.abs(slide(car))).toBeLessThan(0.02);
  });

  it('crawls, turns and reverses at walking pace', () => {
    const car = new Car(GT3_CAR, 'red');
    drive(car, { ...none, throttle: 0.3, steer: 1 }, 2);
    expect(car.speed).toBeGreaterThan(1);
    expect(Math.abs(car.heading)).toBeGreaterThan(0.2);
    const back = new Car(GT3_CAR, 'red');
    drive(back, { ...none, brake: 1 }, 2);
    expect(back.forwardSpeed).toBeLessThan(-1);
  });

  it('can be driven round a lap with keys held on/off, without a spin', () => {
    // A keyboard: each key is either held or not, and the driver changes them 8 times a second.
    for (const id of ['silverstone', 'spa', 'interlagos']) {
      const track = new Track(TRACKS[id]);
      const tt = new TimeTrial(track, id, 'Bot', 'red', 'gt3');
      const bot = new BotDriver(track, 'me', 'medium', CAR_CLASSES.gt3.params);
      let lap: number | null = null;
      tt.onLap = (l) => (lap = l.time);
      let held: DriverInput = none;
      let acc = 1;
      let worst = 0;
      const car = tt.me.car;
      for (let t = 0; t < 200 && lap === null; t += DT) {
        const want = bot.drive(tt.world, { phase: 'practice', raceStart: 0, laps: null, mandatoryStop: false }, DT);
        acc += DT;
        if (acc >= 1 / 8) {
          acc = 0;
          held = { throttle: want.throttle > 0.4 ? 1 : 0, brake: want.brake > 0.15 ? 1 : 0, steer: Math.abs(want.steer) > 0.18 ? Math.sign(want.steer) : 0 };
        }
        tt.step(DT, { ...want, ...held });
        if (car.speed > 10) worst = Math.max(worst, Math.abs(slide(car)));
      }
      expect(lap, id).not.toBeNull();
      expect(worst, id).toBeLessThan(0.45);
    }
  });
});
