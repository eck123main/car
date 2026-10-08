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
