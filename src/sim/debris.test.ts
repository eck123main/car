import { describe, expect, it } from 'vitest';
import { LOST_FRONT_WING, LOST_REAR_WING } from '../physics/car';
import { Track } from '../track/track';
import { TRACKS } from '../tracks';
import { BotDriver, type BotContext } from './ai/botDriver';
import { DEBRIS_LIFE, type Debris } from './debris';
import { IDLE_INPUT, RaceWorld, type PlayerInput, type Racer, type WorldEvent } from './world';

const DT = 1 / 120;
const track = new Track(TRACKS.test);
const zone = track.drsZones[0];

/** Place a car `along` metres into the first DRS straight, `side` metres right of centre. */
function put(r: Racer, along: number, side: number, speed: number, headingOffset = 0): void {
  const t = track.samples[Math.floor((zone.start + along) / 2)];
  const h = Math.atan2(t.ty, t.tx) + headingOffset;
  r.car.place(t.x + t.nx * side, t.y + t.ny * side, h);
  r.car.vx = Math.cos(h) * speed;
  r.car.vy = Math.sin(h) * speed;
}

function run(world: RaceWorld, seconds: number, inputs: Record<string, PlayerInput>): WorldEvent[] {
  const events: WorldEvent[] = [];
  for (let t = 0; t < seconds; t += DT) events.push(...world.step(DT, new Map(Object.entries(inputs))));
  return events;
}

function pair() {
  const world = new RaceWorld(track, { drsRule: 'race', wetness: 0 });
  return { world, a: world.addRacer('a', 'A', 'red'), b: world.addRacer('b', 'B', 'blue') };
}

const CRUISE = { ...IDLE_INPUT, throttle: 0.4 };

/** A wheel lying still on the track, `along` metres into the DRS straight. */
function wheelOnTrack(world: RaceWorld, along: number, side: number): Debris {
  const t = track.samples[Math.floor((zone.start + along) / 2)];
  const q = track.query(t.x + t.nx * side, t.y + t.ny * side)!;
  const piece: Debris = {
    id: 999,
    kind: 'wheel',
    owner: 'nobody',
    compound: 'soft',
    x: t.x + t.nx * side,
    y: t.y + t.ny * side,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    heading: 0,
    spin: 0,
    born: world.time,
    trackIndex: q.index,
    s: q.s,
    d: q.d,
  };
  world.debris.push(piece);
  return piece;
}

describe('Parts coming off', () => {
  it('a big rear-ending knocks both wings off onto the track', () => {
    const { world, a, b } = pair();
    put(a, 30, 0, 15);
    put(b, 15, 0, 50);
    const events = run(world, 0.5, { a: CRUISE, b: CRUISE });
    expect(b.car.lost & LOST_FRONT_WING).toBeTruthy();
    expect(a.car.lost & LOST_REAR_WING).toBeTruthy();
    expect(b.car.parts.frontWing).toBeGreaterThanOrEqual(0.8);
    const kinds = world.debris.map((p) => `${p.owner}:${p.kind}`);
    expect(kinds).toContain('b:frontWing');
    expect(kinds).toContain('a:rearWing');
    expect(kinds.some((k) => k.endsWith('shard'))).toBe(true);
    const lost = events.flatMap((e) => (e.kind === 'debris' && e.what === 'lost' ? [`${e.racerId}:${e.part}`] : []));
    expect(lost).toEqual(expect.arrayContaining(['b:frontWing', 'a:rearWing']));
    // Neither car is out: they can still reach the pits, where the crew fit new wings.
    expect(a.car.retired || b.car.retired).toBe(false);
    a.car.repair();
    expect(a.car.lost).toBe(0);
  });

  it('a light tap loses nothing', () => {
    const { world, a, b } = pair();
    put(a, 30, 0, 30);
    put(b, 20, 0, 42);
    run(world, 0.5, { a: CRUISE, b: CRUISE });
    expect(a.car.lost | b.car.lost).toBe(0);
    expect(world.debris.filter((p) => p.kind !== 'shard')).toEqual([]);
  });

  it('a wreck throws a wheel off, and debris is cleared after 30 s', () => {
    const { world, a } = pair();
    put(a, 30, 0, 0);
    a.car.impact(30, 2.8, 0.5);
    expect(a.car.retired).toBe(true);
    const kinds = world.debris.map((p) => p.kind);
    expect(kinds).toContain('wheel');
    expect(kinds).toContain('frontWing');
    run(world, 1, {});
    // The wheel flew off and is lying somewhere on or by the track.
    const wheel = world.debris.find((p) => p.kind === 'wheel')!;
    expect(Math.hypot(wheel.x - a.car.x, wheel.y - a.car.y)).toBeGreaterThan(1);
    run(world, DEBRIS_LIFE, {});
    expect(world.debris).toEqual([]);
  });
});

describe('Hit reactions', () => {
  it('a car hit hard in the side is shoved sideways and spins', () => {
    const { world, a, b } = pair();
    // b drives straight down the track; a T-bones it from the left at 25 m/s.
    put(b, 60, 0, 30);
    put(a, 62, -4.5, 25, Math.PI / 2);
    const h0 = b.car.heading;
    const side0 = track.query(b.car.x, b.car.y)!.d;
    run(world, 0.1, { a: CRUISE, b: CRUISE });
    expect(b.car.upset).toBeGreaterThan(0.3);
    run(world, 0.8, { a: CRUISE, b: CRUISE });
    const turned = Math.abs(Math.atan2(Math.sin(b.car.heading - h0), Math.cos(b.car.heading - h0)));
    expect(turned).toBeGreaterThan(0.25);
    // Pushed away from the car that hit it (to the right).
    expect(track.query(b.car.x, b.car.y)!.d - side0).toBeGreaterThan(1);
    // And it settles again.
    run(world, 1, { a: IDLE_INPUT, b: CRUISE });
    expect(b.car.upset).toBe(0);
  });
});

describe('Debris on the track', () => {
  it('running over a wheel damages the car and knocks the wheel away', () => {
    const { world, a } = pair();
    put(a, 10, 0, 60);
    const wheel = wheelOnTrack(world, 40, 0);
    const events = run(world, 1, { a: { ...IDLE_INPUT, throttle: 1 } });
    expect(events.some((e) => e.kind === 'debris' && e.what === 'hit' && e.part === 'wheel')).toBe(true);
    expect(a.car.parts.frontWing).toBeGreaterThan(0.1);
    expect(Math.hypot(wheel.vx, wheel.vy)).toBeGreaterThan(5);
    expect(a.car.lost).toBe(0);
  });

  it('bots steer round debris on their line', () => {
    const ctx: BotContext = { phase: 'practice', raceStart: 0, laps: null, mandatoryStop: false };
    /** A hard bot driving from the DRS straight for 4 s; returns where it was across the track 120 m in. */
    const drive = (withWheel: { d: number } | null) => {
      const world = new RaceWorld(track, { drsRule: 'free', wetness: 0 });
      const r = world.addRacer('bot', 'Bot', 'red');
      const bot = new BotDriver(track, 'bot', 'hard');
      put(r, 0, 0, 50);
      if (withWheel) wheelOnTrack(world, 120, withWheel.d);
      const events: WorldEvent[] = [];
      let d = 0;
      for (let t = 0; t < 4; t += DT) {
        events.push(...world.step(DT, new Map([['bot', bot.drive(world, ctx, DT)]])));
        const q = track.query(r.car.x, r.car.y, r.car.trackIndex)!;
        if (Math.abs(track.forwardDistance(zone.start, q.s) - 120) < 1) d = q.d;
      }
      return { d, events };
    };
    // Where it drives with a clear track, then with a wheel lying right there.
    const clear = drive(null);
    const avoided = drive({ d: clear.d });
    expect(avoided.events.filter((e) => e.kind === 'debris')).toEqual([]);
    expect(Math.abs(avoided.d - clear.d)).toBeGreaterThan(1.5);
  });
});
