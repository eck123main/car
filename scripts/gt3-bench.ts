/**
 * How a car class compares with the real cars: acceleration, top speed, braking, cornering g.
 * The Hypercar's hybrid (ERS) is on from 190 km/h, as in a race with the battery to spare.
 *
 *   npx tsx scripts/gt3-bench.ts [gt3 | lmh]
 */
import { Car, type CarWorld } from '../src/physics/car';
import { CAR_CLASSES, isCarClassId } from '../src/sim/carClass';
import { ERS_POWER } from '../src/sim/world';

const arg = process.argv[2] ?? 'gt3';
if (!isCarClassId(arg)) throw new Error(`Unknown class ${arg}`);
const CLS = CAR_CLASSES[arg];
const GT3_CAR = CLS.params;

const DT = 1 / 120;
const flat = {
  surfaceAt: () => ({ type: 'asphalt', grip: 1, drag: 0, dragPerSpeed: 0 }),
  wallContact: () => null,
} as unknown as CarWorld;
const none = { throttle: 0, brake: 0, steer: 0 };

function run(car: Car, input: typeof none, until: (t: number) => boolean): number {
  let t = 0;
  while (!until(t) && t < 300) {
    car.extraPower = CLS.ers && car.speed >= (CLS.ersFrom ?? 0) && input.throttle > 0.5 ? ERS_POWER : 0;
    car.step(input, DT, flat);
    t += DT;
  }
  return t;
}

const launch = new Car(GT3_CAR, 'red');
const t100 = run(launch, { ...none, throttle: 1 }, () => launch.speed >= 100 / 3.6);
const t200 = t100 + run(launch, { ...none, throttle: 1 }, () => launch.speed >= 200 / 3.6);
run(launch, { ...none, throttle: 1 }, (t) => t > 120);
console.log(`0-100 ${t100.toFixed(2)} s, 0-200 ${t200.toFixed(2)} s, top ${(launch.speed * 3.6).toFixed(0)} km/h, gear ${launch.gear}`);

const stop = new Car(GT3_CAR, 'red');
stop.vx = 200 / 3.6;
const tb = run(stop, { ...none, brake: 1 }, () => stop.speed < 1);
console.log(`200-0 ${tb.toFixed(2)} s in ${stop.x.toFixed(0)} m`);

for (const kmh of [70, 120, 180, 250]) {
  // Hold the speed by hand at full lock: how much lateral g do the tyres give?
  const c = new Car(GT3_CAR, 'red');
  const v = kmh / 3.6;
  c.vx = v;
  let peak = 0;
  for (let t = 0; t < 6; t += DT) {
    c.step({ ...none, throttle: 0.2, steer: 1 }, DT, flat);
    const s = c.speed;
    c.vx *= v / s;
    c.vy *= v / s;
    if (t > 2) peak = Math.max(peak, (c.speed * Math.abs(c.yawRate)) / 9.81);
  }
  const slide = Math.atan2(-c.vx * Math.sin(c.heading) + c.vy * Math.cos(c.heading), c.vx * Math.cos(c.heading) + c.vy * Math.sin(c.heading));
  console.log(`${kmh} km/h: ${peak.toFixed(2)} g at full lock, yaw ${c.yawRate.toFixed(3)}, slide ${(slide * 57.3).toFixed(1)} deg`);
}
