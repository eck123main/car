import { describe, expect, it } from 'vitest';
import { IDLE_INPUT } from '../world';
import { OPEN_ROAD_MAPS } from './biomes';
import { OpenRoadDrive, RoadPilot } from './drive';
import { Land, FINE_CELL } from './land';
import { MAX_HEADING, MAX_VERTICAL_CURVE, ROAD_HALF, ROAD_SPACING } from './road';

const DT = 1 / 120;

describe('endless road', () => {
  for (const map of OPEN_ROAD_MAPS) {
    it(`${map.id}: never doubles back and stays gentle for 60 km`, () => {
      const land = new Land(1234, map);
      const r = land.road;
      r.ensure(60000);
      let tightest = Infinity;
      for (let i = 1; i < r.count; i++) {
        expect(r.x[i]).toBeGreaterThan(r.x[i - 1]);
        expect(Math.abs(Math.atan2(r.ty[i], r.tx[i]))).toBeLessThan(MAX_HEADING + 0.2);
        expect(Math.abs(r.vcurv[i])).toBeLessThanOrEqual(MAX_VERTICAL_CURVE + 1e-9);
        expect(Math.abs(r.grade[i])).toBeLessThan(0.1);
        expect(r.z[i]).toBeGreaterThan(0);
        if (Math.abs(r.kappa[i]) > 0) tightest = Math.min(tightest, 1 / Math.abs(r.kappa[i]));
      }
      expect(tightest).toBeGreaterThan(160);
    });
  }

  it('is the same for the same seed, and different for another', () => {
    const map = OPEN_ROAD_MAPS[0];
    const a = new Land(7, map).road;
    const b = new Land(7, map).road;
    const c = new Land(8, map).road;
    a.ensure(5000);
    b.ensure(5000);
    c.ensure(5000);
    expect(a.y.slice(0, 1000)).toEqual(b.y.slice(0, 1000));
    expect(a.y[1500]).not.toEqual(c.y[1500]);
  });

  it('nearest finds the same sample with and without a hint', () => {
    const land = new Land(3, OPEN_ROAD_MAPS[2]);
    const r = land.road;
    r.ensure(8000);
    for (let i = 100; i < 1500; i += 37) {
      const x = r.x[i] - r.ty[i] * 5;
      const y = r.y[i] + r.tx[i] * 5;
      expect(Math.abs(r.nearest(x, y) - i)).toBeLessThanOrEqual(1);
      expect(Math.abs(r.nearest(x, y, i - 8) - i)).toBeLessThanOrEqual(1);
    }
  });
});

describe('land by the road', () => {
  for (const map of OPEN_ROAD_MAPS) {
    it(`${map.id}: never rises over the road's edge on the finest grid`, () => {
      const land = new Land(99, map);
      const r = land.road;
      r.ensure(20000);
      for (let i = 400; i < 5000; i += 9) {
        for (const side of [-1, 1]) {
          // Each grid corner within a cell of the road edge stays low enough not to poke through.
          const off = ROAD_HALF + 1.5;
          const x = r.x[i] - r.ty[i] * off * side;
          const y = r.y[i] + r.tx[i] * off * side;
          expect(land.height(x, y, FINE_CELL)).toBeLessThanOrEqual(r.z[i] + 0.05);
        }
      }
    });
  }
});

describe('driving it', () => {
  for (const map of OPEN_ROAD_MAPS) {
    it(`${map.id}: the pilot stays on the road for 8 km at a brisk pace`, () => {
      const drive = new OpenRoadDrive(map.id, 42);
      const pilot = new RoadPilot(drive.road);
      pilot.cruise = 75;
      pilot.lane = 0;
      let worst = 0;
      let fastest = 0;
      for (let t = 0; drive.distance < 8000 && t < 120 * 400; t++) {
        const ctl = pilot.drive(drive.car);
        drive.step(DT, { ...IDLE_INPUT, ...ctl });
        if (drive.distance > 50) worst = Math.max(worst, Math.abs(drive.roadOffset()));
        fastest = Math.max(fastest, drive.car.speed);
      }
      expect(drive.distance).toBeGreaterThanOrEqual(8000);
      expect(worst).toBeLessThan(ROAD_HALF);
      expect(drive.car.damage).toBe(0);
      expect(fastest).toBeGreaterThan(50);
    });
  }

  /** On/off keys only, looked at 8 times a second, as a person on a keyboard drives. */
  const keyboardDrive = (mapId: string, cruise: number, metres: number) => {
    const drive = new OpenRoadDrive(mapId, 2024);
    const pilot = new RoadPilot(drive.road);
    pilot.cruise = cruise;
    pilot.lane = 0;
    let steer = 0;
    let worst = 0;
    for (let t = 0; drive.distance < metres && t < 120 * 500; t++) {
      const auto = pilot.drive(drive.car);
      if (t % 15 === 0) steer = Math.abs(auto.steer) < 0.12 ? 0 : Math.sign(auto.steer);
      drive.step(DT, { ...IDLE_INPUT, ...auto, steer });
      if (drive.distance > 50) worst = Math.max(worst, Math.abs(drive.roadOffset()));
    }
    return { worst, distance: drive.distance };
  };

  it('stays on the road on a keyboard, flat out, on straights and in bends', () => {
    const fast = keyboardDrive('meadow', 88, 10000);
    expect(fast.distance).toBeGreaterThanOrEqual(10000);
    expect(fast.worst).toBeLessThan(ROAD_HALF);
    const bends = keyboardDrive('alpine', 88, 8000);
    expect(bends.distance).toBeGreaterThanOrEqual(8000);
    expect(bends.worst).toBeLessThan(ROAD_HALF);
  });

  it('reaches the same top speed as the race car on a long straight, more with DRS', () => {
    const top = (drs: boolean) => {
      const drive = new OpenRoadDrive('meadow', 5);
      const pilot = new RoadPilot(drive.road);
      pilot.cruise = 200;
      pilot.cornering = 8;
      pilot.lane = 0;
      let best = 0;
      for (let t = 0; t < 120 * 120; t++) {
        const ctl = pilot.drive(drive.car);
        drive.step(DT, { ...IDLE_INPUT, ...ctl, drs });
        best = Math.max(best, drive.car.speed);
      }
      return best * 3.6;
    };
    const plain = top(false);
    expect(plain).toBeGreaterThan(290);
    expect(top(true)).toBeGreaterThan(plain + 15);
  });

  it('off the road: slower, nothing to hit, and R puts you back', () => {
    const drive = new OpenRoadDrive('meadow', 11);
    for (let t = 0; t < 120 * 8; t++) drive.step(DT, { ...IDLE_INPUT, throttle: 1 });
    const fast = drive.car.speed;
    for (let t = 0; t < 120 * 12; t++) drive.step(DT, { ...IDLE_INPUT, throttle: 1, steer: t < 120 ? 0.35 : 0 });
    expect(Math.abs(drive.roadOffset())).toBeGreaterThan(ROAD_HALF);
    expect(drive.car.speed).toBeLessThan(fast + 40);
    expect(drive.car.damage).toBe(0);
    drive.backOnRoad();
    expect(Math.abs(drive.roadOffset())).toBeLessThan(ROAD_SPACING);
    expect(drive.car.speed).toBe(0);
  });

  it('a long drive never slows the road lookups down or breaks the numbers', () => {
    const drive = new OpenRoadDrive('journey', 77);
    drive.car.x = 300000;
    drive.car.y = 0;
    drive.car.trackIndex = null;
    drive.backOnRoad();
    expect(drive.car.x).toBeGreaterThan(290000);
    for (let t = 0; t < 240; t++) drive.step(DT, { ...IDLE_INPUT, throttle: 1 });
    expect(Number.isFinite(drive.groundZ)).toBe(true);
    expect(drive.car.speed).toBeGreaterThan(5);
  });
});
