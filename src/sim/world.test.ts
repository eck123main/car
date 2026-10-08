import { describe, expect, it } from 'vitest';
import { Track } from '../track/track';
import { TRACKS } from '../tracks';
import { Tyres } from './tyres';
import { IDLE_INPUT, PIT_SPEED_LIMIT, RaceWorld, type PlayerInput, type Racer } from './world';

const DT = 1 / 120;
const track = new Track(TRACKS.test);
const FLAT_OUT: PlayerInput = { ...IDLE_INPUT, throttle: 1 };

function placeAt(r: Racer, s: number, speed: number, offset = 0): void {
  const t = track.samples[Math.floor(s / 2) % track.samples.length];
  const heading = Math.atan2(t.ty, t.tx);
  r.car.place(t.x + t.nx * offset, t.y + t.ny * offset, heading);
  r.car.vx = Math.cos(heading) * speed;
  r.car.vy = Math.sin(heading) * speed;
}

/** Adds steering towards the centreline 20 m ahead, so test cars stay on track. */
function steered(r: Racer, input: PlayerInput): PlayerInput {
  const q = track.query(r.car.x, r.car.y);
  if (!q) return input;
  const aim = track.samples[(q.index + 10) % track.samples.length];
  let err = Math.atan2(aim.y - r.car.y, aim.x - r.car.x) - r.car.heading;
  err = Math.atan2(Math.sin(err), Math.cos(err));
  return { ...input, steer: Math.max(-1, Math.min(1, err * 4)) };
}

function run(world: RaceWorld, seconds: number, inputs: Record<string, PlayerInput>): void {
  for (let t = 0; t < seconds; t += DT) step(world, inputs);
}

function step(world: RaceWorld, inputs: Record<string, PlayerInput>): void {
  const map = new Map<string, PlayerInput>();
  for (const r of world.racers) map.set(r.id, steered(r, inputs[r.id] ?? IDLE_INPUT));
  world.step(DT, map);
}

describe('Tyres', () => {
  it('softs grip more but wear faster than hards', () => {
    const soft = new Tyres('soft');
    const hard = new Tyres('hard');
    expect(soft.grip(0)).toBeGreaterThan(hard.grip(0));
    soft.update(1000, 2000, 0);
    hard.update(1000, 2000, 0);
    expect(soft.wear).toBeGreaterThan(hard.wear * 2);
  });

  it('loses grip with wear, sharply near the end', () => {
    const t = new Tyres('medium');
    const fresh = t.grip(0);
    t.wear = 0.5;
    const half = t.grip(0);
    t.wear = 1;
    expect(half).toBeLessThan(fresh);
    expect(t.grip(0)).toBeLessThan(half * 0.85);
  });

  it('slicks are poor in the wet and wets are good', () => {
    expect(new Tyres('wet').grip(1)).toBeGreaterThan(new Tyres('soft').grip(1) * 1.5);
  });
});

describe('DRS', () => {
  const zone = track.drsZones[0];

  it('opens for a car within a second of the car ahead in a race', () => {
    const world = new RaceWorld(track, { drsRule: 'race', wetness: 0 });
    const ahead = world.addRacer('a', 'A', 'red');
    const behind = world.addRacer('b', 'B', 'blue');
    ahead.timer.lapsCompleted = behind.timer.lapsCompleted = 1;
    placeAt(ahead, zone.detect - 30, 50, -3);
    placeAt(behind, zone.detect - 50, 50, 3);
    const drs = { ...FLAT_OUT, drs: true };
    let behindOpened = false;
    let aheadOpened = false;
    for (let t = 0; t < 4; t += DT) {
      step(world, { a: drs, b: drs });
      behindOpened ||= behind.drsOpen;
      aheadOpened ||= ahead.drsOpen;
    }
    expect(behindOpened).toBe(true);
    expect(aheadOpened).toBe(false);
  });

  it('is not available on the first lap of a race', () => {
    const world = new RaceWorld(track, { drsRule: 'race', wetness: 0 });
    const ahead = world.addRacer('a', 'A', 'red');
    const behind = world.addRacer('b', 'B', 'blue');
    placeAt(ahead, zone.detect - 30, 50, -3);
    placeAt(behind, zone.detect - 50, 50, 3);
    let opened = false;
    for (let t = 0; t < 4; t += DT) {
      step(world, { a: FLAT_OUT, b: { ...FLAT_OUT, drs: true } });
      opened ||= behind.drsOpen;
    }
    expect(opened).toBe(false);
  });

  it('is free to use in practice and closes on braking', () => {
    const world = new RaceWorld(track, { drsRule: 'free', wetness: 0 });
    const r = world.addRacer('a', 'A', 'red');
    placeAt(r, zone.start + 5, 60);
    run(world, 0.2, { a: { ...FLAT_OUT, drs: true } });
    expect(r.drsOpen).toBe(true);
    run(world, 0.2, { a: { ...IDLE_INPUT, brake: 1, drs: true } });
    expect(r.drsOpen).toBe(false);
  });

  it('is disabled in the wet', () => {
    const world = new RaceWorld(track, { drsRule: 'free', wetness: 0.8 });
    const r = world.addRacer('a', 'A', 'red');
    placeAt(r, zone.start + 5, 60);
    run(world, 0.2, { a: { ...FLAT_OUT, drs: true } });
    expect(r.drsOpen).toBe(false);
  });
});

describe('Speed effects', () => {
  /** Speed after a couple of seconds flat out down the first DRS straight. */
  function speedAfter(setup: (w: RaceWorld, r: Racer) => PlayerInput): number {
    const world = new RaceWorld(track, { drsRule: 'free', wetness: 0 });
    const r = world.addRacer('a', 'A', 'red');
    placeAt(r, track.drsZones[0].start + 2, 60);
    const input = setup(world, r);
    run(world, 2, { a: input, lead: FLAT_OUT });
    return r.car.speed;
  }
  const base = speedAfter(() => FLAT_OUT);

  it('DRS, ERS and slipstream each add speed', () => {
    expect(speedAfter(() => ({ ...FLAT_OUT, drs: true }))).toBeGreaterThan(base + 1);
    expect(speedAfter(() => ({ ...FLAT_OUT, ers: true }))).toBeGreaterThan(base + 1);
    const towed = speedAfter((w) => {
      const lead = w.addRacer('lead', 'Lead', 'blue');
      placeAt(lead, track.drsZones[0].start + 17, 60);
      return FLAT_OUT;
    });
    expect(towed).toBeGreaterThan(base + 0.5);
  });

  it('the pit limiter holds the car at the pit lane speed', () => {
    const world = new RaceWorld(track, { drsRule: 'free', wetness: 0 });
    const r = world.addRacer('a', 'A', 'red');
    placeAt(r, track.drsZones[0].start + 2, 10);
    run(world, 3, { a: { ...FLAT_OUT, limiter: true } });
    expect(r.car.speed).toBeLessThan(PIT_SPEED_LIMIT + 0.5);
    expect(r.car.speed).toBeGreaterThan(PIT_SPEED_LIMIT - 1.5);
  });

  it('ERS drains while deployed and recharges under braking', () => {
    const world = new RaceWorld(track, { drsRule: 'free', wetness: 0 });
    const r = world.addRacer('a', 'A', 'red');
    placeAt(r, track.drsZones[0].start + 2, 40);
    run(world, 2, { a: { ...FLAT_OUT, ers: true } });
    const drained = r.ers;
    expect(drained).toBeLessThan(0.8);
    run(world, 1, { a: { ...IDLE_INPUT, brake: 1 } });
    expect(r.ers).toBeGreaterThan(drained);
  });
});
