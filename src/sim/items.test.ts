import { describe, expect, it } from 'vitest';
import { Track } from '../track/track';
import { REAL_TRACK_IDS, TRACKS } from '../tracks';
import { BotDriver, botContext } from './ai/botDriver';
import { BOX_RESPAWN, HOOK_TIME, ItemSystem, itemOdds, placeItemBoxes, rollItem } from './items';
import { DEFAULT_SETTINGS, Session } from './session';
import { RaceWorld, type PlayerInput, type Racer } from './world';

const DT = 1 / 120;
const track = new Track(TRACKS.silverstone);

/** The start of the longest straight-ish stretch (m along the lap). */
function straightStart(t: Track): number {
  const n = t.samples.length;
  let best = 0;
  let bestLen = 0;
  for (let i = 0; i < n; i++) {
    let len = 0;
    while (len < n && Math.abs(t.samples[(i + len) % n].curvature) < 1 / 800) len++;
    if (len > bestLen) {
      bestLen = len;
      best = i;
    }
  }
  return t.samples[best].s;
}

function placeAt(t: Track, r: Racer, s: number, speed: number, lateral = 0): void {
  const smp = t.samples[Math.floor((((s % t.length) + t.length) % t.length) / 2) % t.samples.length];
  const h = Math.atan2(smp.ty, smp.tx);
  r.car.place(smp.x + smp.nx * lateral, smp.y + smp.ny * lateral, h);
  r.car.vx = Math.cos(h) * speed;
  r.car.vy = Math.sin(h) * speed;
}

const CRUISE: PlayerInput = { throttle: 0.6, brake: 0, steer: 0, drs: false, ers: false, limiter: false, nextTyre: 'medium' };

/** Two cars on the straight, b `gap` metres ahead of a, both at `speed`. */
function pair(gap: number, speed = 50, lateralB = 0) {
  const world = new RaceWorld(track, { drsRule: 'race', wetness: 0, collisions: false });
  const a = world.addRacer('a', 'A', 'red');
  const b = world.addRacer('b', 'B', 'blue');
  const s = straightStart(track) + 20;
  placeAt(track, a, s, speed);
  placeAt(track, b, s + gap, speed, lateralB);
  for (const r of [a, b]) r.timer.lapsCompleted = 1;
  const items = new ItemSystem(track);
  // No boxes in the way of these tests.
  for (const box of items.boxes) box.respawnAt = Infinity;
  const step = (inputs: Partial<Record<'a' | 'b', Partial<PlayerInput>>> = {}) => {
    world.step(DT, new Map([['a', { ...CRUISE, ...inputs.a }], ['b', { ...CRUISE, ...inputs.b }]]));
    return items.step(world.racers, world.time, DT);
  };
  return { world, a, b, items, step };
}

describe('Item boxes', () => {
  it.each(REAL_TRACK_IDS)('%s: rows of boxes across the track, on straight-ish road', (id) => {
    const t = new Track(TRACKS[id]);
    const boxes = placeItemBoxes(t);
    const rows = new Set(boxes.map((b) => b.index));
    expect(rows.size).toBeGreaterThanOrEqual(2);
    expect(rows.size).toBeLessThanOrEqual(4);
    for (const b of boxes) {
      const hit = t.query(b.x, b.y)!;
      expect(Math.abs(hit.d)).toBeLessThan(hit.sample.halfWidth);
      expect(Math.abs(t.samples[b.index].curvature)).toBeLessThan(1 / 150);
    }
    for (const i of rows) expect(boxes.filter((b) => b.index === i).length).toBeGreaterThanOrEqual(3);
    // Spread around the lap, not bunched up.
    const s = [...rows].map((i) => t.samples[i].s).sort((x, y) => x - y);
    const gaps = s.map((v, k) => (k === 0 ? v + t.length - s[s.length - 1] : v - s[k - 1]));
    expect(Math.min(...gaps)).toBeGreaterThan(t.length / rows.size / 3);
  });

  it('gives an item when you drive through one, comes back later, and you hold only one', () => {
    const world = new RaceWorld(track, { drsRule: 'race', wetness: 0 });
    const r = world.addRacer('a', 'A', 'red');
    const items = new ItemSystem(track);
    const box = items.boxes[0];
    r.car.place(box.x, box.y, 0);
    items.step(world.racers, 10, DT);
    expect(r.items.held).not.toBeNull();
    expect(box.respawnAt).toBeCloseTo(10 + BOX_RESPAWN);
    // Another box: it breaks, but the item stays the same.
    const first = r.items.held;
    const other = items.boxes[1];
    r.car.place(other.x, other.y, 0);
    items.step(world.racers, 10.1, DT);
    expect(other.respawnAt).toBeGreaterThan(10);
    expect(r.items.held).toBe(first);
  });

  it('gives the leader no hooks or rainbows, and the back markers more of them', () => {
    expect(itemOdds(0).hook).toBe(0);
    expect(itemOdds(0).star).toBe(0);
    expect(itemOdds(1).star).toBeGreaterThan(itemOdds(0.5).star);
    const counts = (back: number) => {
      const c: Record<string, number> = {};
      for (let i = 0; i < 1000; i++) c[rollItem(back, i / 1000)] = (c[rollItem(back, i / 1000)] ?? 0) + 1;
      return c;
    };
    expect(Object.keys(counts(0)).sort()).toEqual(['boost', 'rocket']);
    expect(Object.keys(counts(1)).sort()).toEqual(['boost', 'hook', 'rocket', 'star']);
  });
});

describe('Items', () => {
  it('a rocket flies straight and takes out the car it hits', () => {
    const { a, b, step } = pair(60);
    a.items.held = 'rocket';
    const hits = [...step({ a: { useItem: true } })];
    expect(a.items.held).toBeNull();
    for (let t = 0; t < 3 && hits.length === 0; t += DT) hits.push(...step());
    expect(hits.map((h) => [h.victim.id, h.by.id, h.how])).toEqual([[b.id, a.id, 'rocket']]);
  });

  it('a rocket that misses ends in the wall, harmlessly', () => {
    const { a, items, step } = pair(60);
    a.items.held = 'rocket';
    a.car.heading += 0.35; // pointing off the road
    const hits = [...step({ a: { useItem: true } })];
    expect(items.rockets.length).toBe(1);
    for (let t = 0; t < 4 && items.rockets.length > 0; t += DT) hits.push(...step());
    expect(items.rockets.length).toBe(0);
    expect(hits).toEqual([]);
  });

  it('fires on the press, not while the button is held', () => {
    const { a, step } = pair(60);
    a.items.held = 'boost';
    step({ a: { useItem: true } });
    a.items.held = 'boost';
    step({ a: { useItem: true } });
    expect(a.items.held).toBe('boost');
  });

  it('boost is faster than flat out', () => {
    const run = (boost: boolean) => {
      const { a, step } = pair(200, 40);
      if (boost) a.items.held = 'boost';
      step({ a: { throttle: 1, useItem: boost } });
      for (let t = 0; t < 2; t += DT) step({ a: { throttle: 1 } });
      return a.car.speed;
    };
    expect(run(true)).toBeGreaterThan(run(false) + 8);
  });

  it('hook pulls back the car ahead', () => {
    const run = (hook: boolean) => {
      const { a, b, step } = pair(120, 50);
      if (hook) a.items.held = 'hook';
      step({ a: { useItem: hook } });
      if (hook) expect(b.items.hookedBy).toBe(a.id);
      for (let t = 0; t < HOOK_TIME; t += DT) step();
      return b.car.speed;
    };
    expect(run(true)).toBeLessThan(run(false) - 8);
  });

  it('rainbow: rockets bounce off, and cars it touches are taken out', () => {
    const { a, b, items, step } = pair(40);
    b.items.star = 6;
    a.items.held = 'rocket';
    const hits = [...step({ a: { useItem: true } })];
    for (let t = 0; t < 2 && items.rockets.length > 0; t += DT) hits.push(...step());
    expect(hits).toEqual([]);
    // Now the rainbow car runs into the other one.
    const { a: a2, b: b2, step: step2 } = pair(4, 40, 0.5);
    a2.items.star = 6;
    expect(step2().map((h) => [h.victim.id, h.how])).toEqual([[b2.id, 'star']]);
  });
});

describe('Party race', () => {
  it('bots pick up and use items, and hit cars restart after a moment', () => {
    const players = ['a', 'b', 'c', 'd', 'e', 'f'].map((id, i) => ({ id, name: id.toUpperCase(), color: ['red', 'blue', 'green', 'orange', 'pink', 'cyan'][i] }));
    const session = new Session(track, { ...DEFAULT_SETTINGS, mode: 'party', trackId: 'silverstone', qualifying: false, laps: 2, mandatoryStop: false }, players);
    const bots = players.map((p, i) => new BotDriver(track, p.id, (['hard', 'medium', 'easy'] as const)[i % 3]));
    const used = new Set<string>();
    let hitNotes = 0;
    for (let t = 0; t < 200 && session.phase !== 'finished'; t += DT) {
      const before = new Map(session.world.racers.map((r) => [r.id, r.items.held]));
      const events = session.step(DT, new Map(bots.map((b) => [b.id, b.drive(session.world, botContext(session), DT)])));
      for (const r of session.world.racers) {
        const was = before.get(r.id);
        if (was && r.items.held === null) used.add(was);
      }
      hitNotes += events.filter((e) => e.kind === 'item' && e.text.startsWith('Hit by')).length;
    }
    expect(session.phase).toBe('finished');
    expect(used.size).toBeGreaterThanOrEqual(3);
    expect(hitNotes).toBeGreaterThan(0);
    expect(session.recovering.size).toBe(0);
  }, 60_000);
});
