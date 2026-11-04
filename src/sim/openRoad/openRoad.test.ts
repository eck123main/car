import { describe, expect, it } from 'vitest';
import { IDLE_INPUT } from '../world';
import { OPEN_ROAD_MAPS } from './biomes';
import { CRASH_TIME, OpenRoadDrive, RoadPilot } from './drive';
import { Land, FINE_CELL } from './land';
import { PLANT_TILE, type SolidPlant } from './plants';
import { FENCE_LEFT, FENCE_OFFSET, FENCE_RIGHT, MAX_HEADING, MAX_VERTICAL_CURVE, ROAD_HALF, ROAD_SPACING } from './road';

const DT = 1 / 120;

describe('endless road', () => {
  for (const map of OPEN_ROAD_MAPS) {
    it(`${map.id}: never doubles back and stays driveable for 60 km`, () => {
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
      expect(tightest).toBeGreaterThan(28);
    });

    it(`${map.id}: is mostly bends, with hairpins and big climbs and descents`, () => {
      const land = new Land(1234, map);
      const r = land.road;
      r.ensure(40000);
      let bending = 0;
      let hairpins = 0;
      let inHairpin = false;
      for (let i = 1; i < r.count; i++) {
        const k = Math.abs(r.kappa[i]);
        if (k > 1 / 800) bending++;
        const tight = k > 1 / 70;
        if (tight && !inHairpin) hairpins++;
        inHairpin = tight;
      }
      expect(bending / r.count).toBeGreaterThan(0.3);
      expect(hairpins).toBeGreaterThan(4);
      // Up and down: the biggest rise and fall over 3 km of road.
      let rise = 0;
      let fall = 0;
      const span = Math.round(3000 / ROAD_SPACING);
      for (let i = r.startIndex; i + span < r.count; i += 25) {
        rise = Math.max(rise, r.z[i + span] - r.z[i]);
        fall = Math.max(fall, r.z[i] - r.z[i + span]);
      }
      expect(rise).toBeGreaterThan(60);
      expect(fall).toBeGreaterThan(60);
    });

    it(`${map.id}: the land has no cliffs between the legs of a zigzag`, () => {
      const land = new Land(1234, map);
      const r = land.road;
      r.ensure(20000);
      for (let i = r.startIndex; i < r.count; i += 3) {
        if (Math.abs(r.kappa[i]) < 1 / 70) continue;
        // Across the inside of a hairpin, out past the next leg.
        const side = Math.sign(r.kappa[i]);
        let last = land.height(r.x[i], r.y[i]);
        for (let d = 6; d < 200; d += 6) {
          const h = land.height(r.x[i] - r.ty[i] * d * side, r.y[i] + r.tx[i] * d * side);
          expect(Math.abs(h - last)).toBeLessThan(14);
          last = h;
        }
      }
    });
  }

  it('a car driven off one leg of a zigzag finds the next leg is road', () => {
    const land = new Land(1234, OPEN_ROAD_MAPS.find((m) => m.id === 'alpine')!);
    const r = land.road;
    r.ensure(12000);
    let i = r.startIndex;
    while (Math.abs(Math.atan2(r.ty[i], r.tx[i])) < MAX_HEADING - 0.02 || Math.abs(r.kappa[i]) > 0) i++;
    // Straight on the next leg, 60 samples (240 m) of road further on.
    const j = i + 90;
    expect(r.nearest(r.x[j], r.y[j], i)).toBe(j);
  });

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

  it('reaches the same top speed as the race car when given the room, more with DRS', () => {
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

  it('off the road: slower, and R puts you back', () => {
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

  /** A fenced straight stretch of road, and which side to try. */
  const fenced = (drive: OpenRoadDrive) => {
    const r = drive.road;
    r.ensure(30000);
    for (let i = r.startIndex; i < r.count - 40; i++) {
      for (const [bit, side] of [[FENCE_LEFT, -1], [FENCE_RIGHT, 1]] as const) {
        let all = true;
        for (let k = i; k < i + 30; k++) all = all && (r.fence[k] & bit) !== 0 && Math.abs(r.kappa[k]) < 1 / 400;
        if (all) return { i, side };
      }
    }
    throw new Error('no fenced straight');
  };

  it('every map has fences over hills and round the outside of hairpins', () => {
    for (const map of OPEN_ROAD_MAPS) {
      const r = new Land(1234, map).road;
      r.ensure(30000);
      let fenced = 0;
      for (let i = 0; i < r.count; i++) {
        if (r.fence[i]) fenced++;
        if (Math.abs(r.kappa[i]) > 1 / 60) expect(r.fence[i] & (r.kappa[i] > 0 ? FENCE_LEFT : FENCE_RIGHT)).not.toBe(0);
      }
      expect(fenced / r.count).toBeGreaterThan(0.1);
    }
  });

  it('a fence holds the car on the road: a glancing touch slides along, a hard hit crashes', () => {
    const glance = new OpenRoadDrive('alpine', 1234);
    const { i, side } = fenced(glance);
    const r = glance.road;
    const place = (drive: OpenRoadDrive, angle: number, speed: number) => {
      const heading = Math.atan2(r.ty[i], r.tx[i]) + angle * side;
      drive.car.place(r.x[i] - r.ty[i] * 5 * side, r.y[i] + r.tx[i] * 5 * side, heading, i);
      drive.car.vx = Math.cos(heading) * speed;
      drive.car.vy = Math.sin(heading) * speed;
    };
    place(glance, 0.12, 30);
    let furthest = 0;
    for (let t = 0; t < 120; t++) {
      glance.step(DT, { ...IDLE_INPUT, throttle: 0.4 });
      furthest = Math.max(furthest, Math.abs(glance.roadOffset()));
    }
    expect(glance.crashes).toBe(0);
    expect(furthest).toBeLessThan(FENCE_OFFSET);
    expect(glance.car.speed).toBeGreaterThan(20);

    const hard = new OpenRoadDrive('alpine', 1234);
    fenced(hard);
    place(hard, 0.9, 45);
    for (let t = 0; t < 120 && hard.crashes === 0; t++) hard.step(DT, { ...IDLE_INPUT, throttle: 1 });
    expect(hard.crashes).toBe(1);
    expect(Math.abs(hard.roadOffset())).toBeLessThan(FENCE_OFFSET);
  });

  /** Aim the car straight at the nearest big solid plant to the road, from 40 m away. */
  const aimAtPlant = (drive: OpenRoadDrive, kinds: string[], speed: number) => {
    const r = drive.road;
    const i = r.startIndex + 200;
    const plants: SolidPlant[] = [];
    for (let iy = -3; iy <= 3; iy++) {
      for (let ix = -3; ix <= 3; ix++) {
        plants.push(...drive.plants.tile(Math.floor(r.x[i] / PLANT_TILE) + ix, Math.floor(r.y[i] / PLANT_TILE) + iy));
      }
    }
    const p = plants.filter((q) => kinds.includes(q.kind)).sort((a, b) => Math.hypot(a.x - r.x[i], a.y - r.y[i]) - Math.hypot(b.x - r.x[i], b.y - r.y[i]))[0];
    expect(p).toBeDefined();
    const angle = Math.atan2(r.y[i] - p.y, r.x[i] - p.x);
    const x = p.x + Math.cos(angle) * 40;
    const y = p.y + Math.sin(angle) * 40;
    drive.car.place(x, y, angle + Math.PI, i);
    drive.car.vx = -Math.cos(angle) * speed;
    drive.car.vy = -Math.sin(angle) * speed;
    return p;
  };

  it('hitting a tree fast is a crash: stopped, then back on the road near where you were', () => {
    const drive = new OpenRoadDrive('forest', 5);
    const p = aimAtPlant(drive, ['pine', 'broadleaf', 'birch'], 40);
    for (let t = 0; t < 120 * 2 && drive.crashes === 0; t++) drive.step(DT, { ...IDLE_INPUT, throttle: 1 });
    expect(drive.crashes).toBe(1);
    expect(drive.car.speed).toBe(0);
    expect(Math.hypot(drive.car.x - p.x, drive.car.y - p.y)).toBeLessThan(8);
    expect(drive.car.damage).toBeGreaterThan(0);
    let backAt = -1;
    for (let t = 0; t < 120 * 3 && backAt < 0; t++) {
      drive.step(DT, { ...IDLE_INPUT, throttle: 1, steer: 1 });
      if (drive.rescued) backAt = t;
    }
    expect(backAt / 120).toBeCloseTo(CRASH_TIME, 1);
    expect(drive.rescuedBy).toBe('crash');
    expect(Math.abs(drive.roadOffset())).toBeLessThan(ROAD_SPACING);
    expect(drive.car.speed).toBe(0);
    expect(drive.car.damage).toBe(0);
    expect(drive.car.retired).toBe(false);
    // Near where you were: the road beside the tree, not back at the start.
    expect(Math.hypot(drive.car.x - p.x, drive.car.y - p.y)).toBeLessThan(250);
  });

  it('a rock counts too, a slow tap only bumps, and the car bounces clear', () => {
    const drive = new OpenRoadDrive('desert', 5);
    aimAtPlant(drive, ['boulder'], 40);
    for (let t = 0; t < 120 * 2 && drive.crashes === 0; t++) drive.step(DT, { ...IDLE_INPUT, throttle: 1 });
    expect(drive.crashes).toBe(1);

    const slow = new OpenRoadDrive('forest', 5);
    const p = aimAtPlant(slow, ['pine', 'broadleaf', 'birch'], 6);
    let closest = Infinity;
    for (let t = 0; t < 120 * 10; t++) {
      slow.step(DT, { ...IDLE_INPUT, brake: 0 });
      closest = Math.min(closest, Math.hypot(slow.car.x - p.x, slow.car.y - p.y));
    }
    expect(slow.crashes).toBe(0);
    expect(Math.abs(slow.roadOffset())).toBeGreaterThan(ROAD_HALF);
    expect(closest).toBeGreaterThan(p.radius);
  });

  it('shrubs are soft, and the road is always clear of anything solid', () => {
    for (const map of OPEN_ROAD_MAPS) {
      const drive = new OpenRoadDrive(map.id, 3);
      const r = drive.road;
      for (let i = r.startIndex; i < r.startIndex + 500; i += 40) {
        drive.plants.near(r.x[i], r.y[i], 60, (p) => {
          expect(p.kind).not.toBe('shrub');
          const near = r.nearest(p.x, p.y);
          expect(Math.abs(r.lateral(near, p.x, p.y)) - p.radius).toBeGreaterThan(ROAD_HALF);
        });
      }
    }
  }, 30000);

  it('what is solid does not depend on when it was worked out', () => {
    const a = new OpenRoadDrive('alpine', 8);
    const b = new OpenRoadDrive('alpine', 8);
    b.road.ensure(30000);
    expect(a.plants.tile(0, 0)).toEqual(b.plants.tile(0, 0));
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
