import { describe, expect, it } from 'vitest';
import { Track } from '../track/track';
import { TRACKS } from '../tracks';
import { IDLE_INPUT, penaltyTime, RaceWorld, type PlayerInput, type Racer, type WorldEvent } from './world';

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

function pair(collisions = true) {
  const world = new RaceWorld(track, { drsRule: 'race', wetness: 0, collisions });
  return { world, a: world.addRacer('a', 'A', 'red'), b: world.addRacer('b', 'B', 'blue') };
}

const CRUISE = { ...IDLE_INPUT, throttle: 0.4 };

describe('Car collisions', () => {
  it('warns, then penalises, the car that runs into the back of another', () => {
    const { world, a, b } = pair();
    put(a, 30, 0, 35);
    put(b, 20, 0, 45);
    const events = run(world, 1, { a: CRUISE, b: CRUISE });
    // First minor offence: a warning, no time.
    expect(penaltyTime(b)).toBe(0);
    expect(b.collisionWarnings).toBe(1);
    const verdicts = events.flatMap((e) => (e.kind === 'contact' ? [`${e.racerId}:${e.verdict}`] : []));
    expect(verdicts).toEqual(['a:theirFault', 'b:yourFault']);
    // Both cars are damaged.
    expect(a.car.damage).toBeGreaterThan(0);
    expect(b.car.damage).toBeGreaterThan(0);
    // Doing it again (after the 3 s judging cooldown) costs 5 s.
    run(world, 3, { a: CRUISE, b: CRUISE });
    put(a, 120, 0, 35);
    put(b, 110, 0, 45);
    run(world, 1, { a: CRUISE, b: CRUISE });
    expect(penaltyTime(b)).toBe(5);
    expect(b.penalties[0].reason).toMatch(/collision with A/);
    expect(penaltyTime(a)).toBe(0);
  });

  it('penalises a big hit straight away', () => {
    const { world, a, b } = pair();
    put(a, 30, 0, 20);
    put(b, 15, 0, 40);
    run(world, 1, { a: CRUISE, b: CRUISE });
    expect(penaltyTime(b)).toBe(10);
  });

  it('ignores light contact', () => {
    const { world, a, b } = pair();
    put(a, 30, 0, 38);
    put(b, 20, 0, 43);
    run(world, 1, { a: CRUISE, b: CRUISE });
    expect(penaltyTime(b) + b.collisionWarnings).toBe(0);
  });

  it('treats side-by-side rubbing as a racing incident', () => {
    const { world, a, b } = pair();
    put(a, 20, -1.2, 45, 0.1);
    put(b, 20, 1.2, 45, -0.1);
    const events = run(world, 1, { a: CRUISE, b: CRUISE });
    expect(penaltyTime(a) + penaltyTime(b)).toBe(0);
    expect(events.some((e) => e.kind === 'penalty')).toBe(false);
    // They did hit hard enough to be judged.
    expect(events.some((e) => e.kind === 'contact' && e.verdict === 'incident')).toBe(true);
  });

  it('blames a dive-bomb into the side of another car', () => {
    const { world, a, b } = pair();
    put(a, 30, 1.5, 30);
    // b comes in at an angle, nose first, much faster into the contact.
    put(b, 24, -5, 40, 0.6);
    run(world, 0.6, { a: CRUISE, b: CRUISE });
    expect(penaltyTime(b)).toBeGreaterThan(0);
    expect(penaltyTime(a)).toBe(0);
  });

  it('blames a car that moves across right in front of another, not the car that hits it', () => {
    const { world, a, b } = pair();
    // a is just to the left of b's line and swerves right across b's nose; b is faster.
    put(a, 30, -1.4, 30, 0.08);
    put(b, 16.6, 1.2, 42);
    const events = run(world, 1, { a: CRUISE, b: CRUISE });
    const verdicts = events.flatMap((e) => (e.kind === 'contact' ? [`${e.racerId}:${e.verdict}`] : []));
    expect(verdicts).toEqual(['a:yourFault', 'b:theirFault']);
    expect(b.collisionWarnings + penaltyTime(b)).toBe(0);
    expect(a.collisionWarnings).toBe(1);
  });

  it('still blames the car behind when the car ahead moved over in good time', () => {
    const { world, a, b } = pair();
    // a drives in the left lane, then moves into b's lane over a second before b reaches it.
    put(a, 30, -3, 30);
    put(b, 0, 1.2, 30);
    run(world, 0.5, { a: CRUISE, b: CRUISE });
    put(a, 60, 1.2, 30);
    put(b, 60 - 5.6 - 13, 1.2, 42);
    const events = run(world, 2, { a: CRUISE, b: CRUISE });
    const verdicts = events.flatMap((e) => (e.kind === 'contact' ? [`${e.racerId}:${e.verdict}`] : []));
    expect(verdicts).toEqual(['a:theirFault', 'b:yourFault']);
  });

  it('blames a car that moves sideways into a car alongside', () => {
    const { world, a, b } = pair();
    put(a, 29, -3, 40, 0.25);
    put(b, 30.5, 1.5, 40);
    const events = run(world, 0.5, { a: CRUISE, b: CRUISE });
    const verdicts = events.flatMap((e) => (e.kind === 'contact' ? [`${e.racerId}:${e.verdict}`] : []));
    expect(verdicts).toEqual(['a:yourFault', 'b:theirFault']);
  });

  it('keeps cars from passing through each other', () => {
    const { world, a, b } = pair();
    put(a, 30, 0, 20);
    put(b, 10, 0, 45);
    run(world, 2, { a: CRUISE, b: { ...IDLE_INPUT, throttle: 1 } });
    const qa = track.query(a.car.x, a.car.y)!;
    const qb = track.query(b.car.x, b.car.y)!;
    // b is still behind a (it shoved a rather than passing through).
    expect(qa.s).toBeGreaterThan(qb.s);
  });

  it('cars are ghosts when collisions are off (qualifying)', () => {
    const { world, a, b } = pair(false);
    put(a, 30, 0, 20);
    put(b, 20, 0, 45);
    run(world, 1, { a: CRUISE, b: CRUISE });
    expect(a.car.damage + b.car.damage).toBe(0);
    expect(penaltyTime(b)).toBe(0);
  });

  it('does not judge the same pair again straight away', () => {
    const { world, a, b } = pair();
    put(a, 30, 0, 30);
    put(b, 20, 0, 45);
    run(world, 2, { a: CRUISE, b: { ...IDLE_INPUT, throttle: 1 } });
    expect(b.penalties).toHaveLength(1);
  });
});
