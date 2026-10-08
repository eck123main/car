import { describe, expect, it } from 'vitest';
import { SURFACES, type Surface } from '../track/types';
import { Car, type CarWorld, type DriverInput } from './car';
import { F1_CAR } from './carParams';

const DT = 1 / 120;
const on = (surface: Surface): CarWorld => ({ surfaceAt: () => surface, wallContact: () => null });

function run(world: CarWorld, seconds: number, input: DriverInput, setup?: (c: Car) => void): Car {
  const car = new Car(F1_CAR, 'red');
  car.place(0, 0, 0);
  setup?.(car);
  for (let t = 0; t < seconds; t += DT) car.step(input, DT, world);
  return car;
}

const FLAT_OUT = { throttle: 1, brake: 0, steer: 0 };
const kmh = (c: Car) => c.speed * 3.6;

describe('Car', () => {
  it('accelerates and tops out like an F1 car on asphalt', () => {
    expect(kmh(run(on(SURFACES.asphalt), 30, FLAT_OUT))).toBeGreaterThan(320);
  });

  it('is much slower flat out on grass and gravel', () => {
    expect(kmh(run(on(SURFACES.grass), 30, FLAT_OUT))).toBeLessThan(130);
    expect(kmh(run(on(SURFACES.gravel), 30, FLAT_OUT))).toBeLessThan(70);
  });

  it('bogs down quickly when running off at speed', () => {
    const car = run(on(SURFACES.gravel), 2, FLAT_OUT, (c) => (c.vx = 70));
    expect(kmh(car)).toBeLessThan(130);
  });

  it('does not spin at full lock and full throttle', () => {
    const car = run(on(SURFACES.asphalt), 4, { throttle: 1, brake: 0, steer: 1 }, (c) => (c.vx = 40));
    const slip = Math.atan2(car.vy, car.vx) - car.heading;
    expect(Math.abs(Math.atan2(Math.sin(slip), Math.cos(slip)))).toBeLessThan(0.15);
  });

  it('still turns while braking', () => {
    const steer = (brake: number) =>
      run(on(SURFACES.asphalt), 0.5, { throttle: 0, brake, steer: 1 }, (c) => (c.vx = 40)).heading;
    expect(steer(1)).toBeGreaterThan(steer(0) * 0.6);
  });
});

describe('Part damage', () => {
  const fresh = () => {
    const c = new Car(F1_CAR, 'red');
    c.place(0, 0, 0);
    return c;
  };

  it('breaks the part that was hit', () => {
    const nose = fresh();
    nose.impact(12, 2.6, 0.5);
    expect(nose.parts.frontWing).toBeGreaterThan(0.2);
    expect(nose.parts.right).toBeGreaterThan(0);
    expect(nose.parts.rearWing).toBe(0);

    const side = fresh();
    side.impact(12, 0, -0.9);
    expect(side.parts.left).toBeGreaterThan(0.2);
    expect(side.parts.frontWing).toBe(0);
    expect(side.damage).toBe(side.parts.left);
  });

  /** Heading change after a second at full lock from 150 km/h. */
  const turn = (setup: (c: Car) => void) =>
    run(on(SURFACES.asphalt), 1, { throttle: 0, brake: 0, steer: 1 }, (c) => {
      c.vx = 42;
      setup(c);
    }).heading;

  it('a broken front wing makes the car turn less', () => {
    expect(turn((c) => (c.parts.frontWing = 0.8))).toBeLessThan(turn(() => {}) * 0.8);
  });

  it('a broken rear wing costs grip in fast corners', () => {
    expect(turn((c) => (c.parts.rearWing = 0.8))).toBeLessThan(turn(() => {}) * 0.95);
  });

  it('side damage lowers top speed and pulls the car to that side', () => {
    const top = run(on(SURFACES.asphalt), 30, FLAT_OUT, (c) => (c.parts.right = 0.8));
    expect(kmh(top)).toBeLessThan(kmh(run(on(SURFACES.asphalt), 30, FLAT_OUT)) - 10);
    const pulled = run(on(SURFACES.asphalt), 1, FLAT_OUT, (c) => {
      c.vx = 40;
      c.parts.right = 0.8;
    });
    expect(pulled.heading).toBeGreaterThan(0.05);
  });

  it('a pit repair fixes everything', () => {
    const c = fresh();
    c.impact(15, 2.6, 0);
    c.repair();
    expect(c.damage).toBe(0);
  });
});
