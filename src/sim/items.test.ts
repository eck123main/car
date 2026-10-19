import { describe, expect, it } from 'vitest';
import { Track } from '../track/track';
import { REAL_TRACK_IDS, TRACKS } from '../tracks';
import { BotDriver, botContext } from './ai/botDriver';
import { BOX_RESPAWN, HOOK_TIME, ITEM_KINDS, ItemSystem, itemOdds, placeItemBoxes, rollItem, ZAP_TIME } from './items';
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
    // The leader never gets the catch-up items.
    const leader = Object.keys(counts(0));
    for (const k of ['hook', 'magnet', 'homing', 'blue', 'lightning', 'teleport', 'star', 'ghost']) expect(leader).not.toContain(k);
    expect(leader).toContain('shield');
    // Everything turns up for someone.
    expect(Object.keys(counts(1)).length + 0).toBeGreaterThanOrEqual(12);
    expect(new Set([...Object.keys(counts(0)), ...Object.keys(counts(0.5)), ...Object.keys(counts(1))]).size).toBe(ITEM_KINDS.length);
    // Things to drop are mostly for the front.
    expect(itemOdds(0).barrier).toBeGreaterThan(itemOdds(1).barrier);
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

  it('a tyre barrier dropped behind takes out the car that runs into it, then is gone', () => {
    // b leads; a follows 30 m back, on b's line.
    const { a, b, items, step } = pair(30);
    b.items.held = 'barrier';
    const hits = [...step({ b: { useItem: true } })];
    expect(items.drops.length).toBe(1);
    // b doesn't hit its own barrier as it drives away.
    for (let t = 0; t < 2 && hits.length === 0; t += DT) hits.push(...step());
    expect(hits.map((h) => [h.victim.id, h.by.id, h.how])).toEqual([[a.id, b.id, 'barrier']]);
    expect(items.drops.length).toBe(0);
  });

  it('oil makes the car that hits it slide and slow down, then is gone', () => {
    const run = (oil: boolean) => {
      const { a, b, items, step } = pair(30);
      if (oil) b.items.held = 'oil';
      step({ b: { useItem: oil } });
      let slid = false;
      for (let t = 0; t < 2; t += DT) {
        expect(step()).toEqual([]);
        slid ||= a.items.slip > 0;
      }
      if (oil) {
        expect(slid).toBe(true);
        expect(items.drops.length).toBe(0);
      }
      return a.car.speed;
    };
    expect(run(true)).toBeLessThan(run(false) - 3);
  });

  it('a rocket that meets a dropped item: both are gone', () => {
    const { a, b, items, step } = pair(80);
    b.items.held = 'barrier';
    step({ b: { useItem: true } });
    a.items.held = 'rocket';
    const hits = [...step({ a: { useItem: true } })];
    for (let t = 0; t < 2 && items.rockets.length > 0; t += DT) hits.push(...step());
    expect(items.drops.length).toBe(0);
    expect(hits).toEqual([]);
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

describe('More items', () => {
  it('triple rockets: three shots, one per press', () => {
    const { a, items, step } = pair(300);
    a.items.held = 'triple';
    a.items.charges = 3;
    for (let k = 0; k < 3; k++) {
      step({ a: { useItem: true } });
      step();
    }
    expect(items.rockets.length).toBe(3);
    expect(a.items.held).toBeNull();
  });

  it('a homing rocket follows the track to the car ahead, round the corners', () => {
    // The target (driven by a bot) is well up the road.
    const { world, a, b, items } = pair(250, 50, 5);
    const bot = new BotDriver(track, b.id, 'hard');
    const ctx = { phase: 'practice' as const, raceStart: 0, laps: null, mandatoryStop: false };
    a.items.held = 'homing';
    const hits = [];
    for (let t = 0; t < 12 && hits.length === 0; t += DT) {
      world.step(DT, new Map([['a', { ...CRUISE, throttle: 0, brake: 1, useItem: t === 0 }], ['b', bot.drive(world, ctx, DT)]]));
      hits.push(...items.step(world.racers, world.time, DT));
      if (t === 0) expect(items.rockets[0].target).toBe(b.id);
    }
    expect(hits.map((h) => [h.victim.id, h.how])).toEqual([[b.id, 'homing']]);
  });

  it('a blue shell goes for the leader, past the car in between', () => {
    const world = new RaceWorld(track, { drsRule: 'race', wetness: 0, collisions: false });
    const [a, mid, lead] = ['a', 'm', 'l'].map((id) => world.addRacer(id, id.toUpperCase(), 'red'));
    const s = straightStart(track) + 20;
    placeAt(track, a, s, 50);
    placeAt(track, mid, s + 60, 50);
    placeAt(track, lead, s + 200, 50, 4);
    for (const r of world.racers) r.timer.lapsCompleted = 1;
    const items = new ItemSystem(track);
    for (const box of items.boxes) box.respawnAt = Infinity;
    a.items.held = 'blue';
    const hits = [];
    for (let t = 0; t < 10 && hits.length === 0; t += DT) {
      world.step(DT, new Map(world.racers.map((r) => [r.id, { ...CRUISE, useItem: r === a && t === 0 }])));
      hits.push(...items.step(world.racers, world.time, DT));
    }
    expect(hits.map((h) => [h.victim.id, h.how])).toEqual([[lead.id, 'blue']]);
  });

  it('a shield blocks one hit, then it is gone', () => {
    const { a, b, items, step } = pair(60);
    b.items.shield = 10;
    a.items.held = 'triple';
    a.items.charges = 3;
    const hits = [...step({ a: { useItem: true } })];
    for (let t = 0; t < 2 && items.rockets.length > 0; t += DT) hits.push(...step());
    expect(hits).toEqual([]);
    expect(b.items.shield).toBe(0);
    step({ a: { useItem: true } });
    for (let t = 0; t < 2 && items.rockets.length > 0; t += DT) hits.push(...step());
    expect(hits.map((h) => h.victim.id)).toEqual([b.id]);
  });

  it('lightning slows every car ahead, not the ones behind', () => {
    const { a, b, step } = pair(100);
    b.items.held = 'lightning';
    step({ b: { useItem: true } });
    expect(b.items.zap).toBe(0);
    expect(a.items.zap).toBe(0);
    a.items.held = 'lightning';
    step({ a: { useItem: true } });
    expect(b.items.zap).toBeCloseTo(ZAP_TIME, 1);
  });

  it('magnet pulls you up to the car ahead', () => {
    const run = (magnet: boolean) => {
      const { a, step } = pair(100, 45);
      if (magnet) a.items.held = 'magnet';
      step({ a: { useItem: magnet } });
      for (let t = 0; t < 2; t += DT) step();
      return a.car.speed;
    };
    expect(run(true)).toBeGreaterThan(run(false) + 8);
  });

  it('teleport puts you just behind the car ahead, never past a timing line', () => {
    const { a, b, step } = pair(300);
    a.items.held = 'teleport';
    step({ a: { useItem: true } });
    const gap = track.forwardDistance(track.query(a.car.x, a.car.y)!.s, track.query(b.car.x, b.car.y)!.s);
    const toLine = track.forwardDistance(track.query(a.car.x, a.car.y)!.s, a.timer.nextLine() % track.length);
    expect(a.items.held).toBeNull();
    expect(gap < 30 || toLine < 10).toBe(true);
    expect(gap).toBeLessThan(300);
  });

  it('mines go off for anyone within a few metres (even off to the side), and smoke never gets used up', () => {
    const { a, b, items, step } = pair(30, 50, 0);
    b.items.held = 'mine';
    step({ b: { useItem: true } });
    // a passes 4 m to the side of it.
    a.car.y += 4 * Math.cos(a.car.heading);
    a.car.x -= 4 * Math.sin(a.car.heading);
    const hits = [];
    for (let t = 0; t < 1.5 && hits.length === 0; t += DT) hits.push(...step());
    expect(hits.map((h) => [h.victim.id, h.how])).toEqual([[a.id, 'mine']]);
    b.items.held = 'smoke';
    step({ b: { useItem: true } });
    for (let t = 0; t < 2; t += DT) step();
    expect(items.drops.filter((d) => d.kind === 'smoke').length).toBe(1);
  });

  it('fresh tyres: new tyres of the same compound', () => {
    const { a, step } = pair(100);
    a.tyres.wear = 0.6;
    a.items.held = 'tyres';
    step({ a: { useItem: true } });
    expect(a.tyres.wear).toBeLessThan(0.01);
    expect(a.tyres.compound).toBe('medium');
  });

  it('ghost: steals an item, and rockets and dropped items pass through', () => {
    const { a, b, items, step } = pair(40);
    b.items.held = 'rocket';
    b.items.charges = 1;
    a.items.held = 'ghost';
    step({ a: { useItem: true } });
    expect(a.items.held).toBe('rocket');
    expect(b.items.held).toBeNull();
    expect(a.items.ghost).toBeGreaterThan(0);
    // b drops a barrier: a drives straight through it, and it's still there afterwards.
    b.items.held = 'barrier';
    const hits = [...step({ b: { useItem: true } })];
    for (let t = 0; t < 1; t += DT) hits.push(...step());
    expect(hits).toEqual([]);
    expect(items.drops.length).toBe(1);
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
