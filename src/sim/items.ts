import type { Car } from '../physics/car';
import type { Track } from '../track/track';
import { raceProgress, type Racer } from './world';

/**
 * Party mode: Mario Kart style item boxes on an otherwise normal race.
 * Rows of boxes sit across the track on straights; driving through one gives a random item
 * (if you aren't holding one already), and the box comes back a few seconds later.
 * The further back you are, the better the odds of the strong items.
 */
export type ItemKind = 'boost' | 'rocket' | 'hook' | 'star' | 'oil' | 'barrier';
export const ITEM_KINDS: ItemKind[] = ['boost', 'rocket', 'hook', 'star', 'oil', 'barrier'];
/** Items dropped behind the car, which stay on the track until someone hits them. */
export type DropKind = 'oil' | 'barrier';

export const ITEM_INFO: Record<ItemKind, { name: string; color: string }> = {
  boost: { name: 'Boost', color: '#ffb000' },
  rocket: { name: 'Rocket', color: '#ff4136' },
  hook: { name: 'Hook', color: '#2ecc40' },
  star: { name: 'Rainbow', color: '#ff66ff' },
  oil: { name: 'Oil slick', color: '#8a7cff' },
  barrier: { name: 'Tyre barrier', color: '#ff8c1a' },
};

/** A box comes back this long (s) after it is picked up. */
export const BOX_RESPAWN = 4;
/** A car picks up a box this close to its centre (m). */
const PICKUP_RADIUS = 2.8;
/** Boost: a straight shove forwards, and less drag, so it beats the normal top speed. */
export const BOOST_TIME = 2.5;
const BOOST_PUSH = 14000;
/** Rainbow: a longer, gentler boost; rockets can't hurt you and anyone you touch spins out. */
export const STAR_TIME = 6;
const STAR_PUSH = 3500;
/** Hook: the car ahead is pulled back towards you. */
export const HOOK_TIME = 1.5;
const HOOK_PULL = 7000;
/** Hook reaches a car at most this far ahead (m of race distance). */
export const HOOK_RANGE = 250;
/** Rockets fly straight at this much more than the car's speed, until a wall, a car or timeout. */
const ROCKET_EXTRA_SPEED = 45;
const ROCKET_LIFE = 4;
const ROCKET_HIT_RADIUS = 2.6;
/** A car hit by a rocket (or a rainbow car) stops and restarts after this long (s). */
export const KNOCKOUT_WAIT = 2;
/** Dropped items: placed this far behind the car's centre; the car that dropped one can't hit it for a moment. */
const DROP_BEHIND = 5.5;
const DROP_ARM = 0.7;
const DROP_RADIUS = 2.4;
/** Dropped items clear themselves after this long (s), and at most this many lie on the track. */
const DROP_LIFE = 90;
const MAX_DROPS = 24;
/** Oil: the car slides (little grip) and loses speed for a moment. */
export const SLIP_TIME = 1.4;
const SLIP_GRIP = 0.3;
const SLIP_DRAG = 3000;

export interface ItemState {
  held: ItemKind | null;
  /** Seconds left of each effect. */
  boost: number;
  star: number;
  hooked: number;
  /** Who hooked this car (for drawing the line). */
  hookedBy: string | null;
  /** On oil: seconds of sliding left. */
  slip: number;
  /** The use button was down last step (items fire on the press, not while held). */
  wasPressed: boolean;
}

export function newItemState(): ItemState {
  return { held: null, boost: 0, star: 0, hooked: 0, hookedBy: null, slip: 0, wasPressed: false };
}

export interface ItemBox {
  x: number;
  y: number;
  /** Track sample the box sits on. */
  index: number;
  /** Simulation time it is back (it's there when time >= respawnAt). */
  respawnAt: number;
}

export interface Rocket {
  x: number;
  y: number;
  heading: number;
  speed: number;
  /** Track sample it is over (hint for wall checks). */
  index: number | null;
  owner: string;
  until: number;
}

export interface Drop {
  kind: DropKind;
  x: number;
  y: number;
  heading: number;
  owner: string;
  /** The owner can hit it from this time; gone at `until`. */
  armedAt: number;
  until: number;
}

/** What to draw: boxes that are there now, rockets in flight and items dropped on the track. */
export interface ItemView {
  boxes: { x: number; y: number }[];
  rockets: { x: number; y: number; heading: number }[];
  drops: { kind: DropKind; x: number; y: number; heading: number }[];
}

/** Someone was taken out by an item. */
export interface ItemHit {
  victim: Racer;
  by: Racer;
  how: 'rocket' | 'star' | 'barrier';
}

/**
 * Where the boxes go: a few rows across the track, spread around the lap, each on the
 * straightest stretch near its share of the lap (so cars reach them at speed, not mid-corner),
 * clear of the start line and of places where another part of the track is close.
 */
export function placeItemBoxes(track: Track): ItemBox[] {
  const samples = track.samples;
  const n = samples.length;
  const step = track.length / n;
  const rows = Math.max(2, Math.min(4, Math.round(track.length / 900)));
  const span = Math.round(40 / step);
  const bendiness = (i: number) => {
    let max = 0;
    for (let k = -span; k <= span; k++) max = Math.max(max, Math.abs(samples[(i + k + n) % n].curvature));
    return max;
  };
  const out: ItemBox[] = [];
  const chosen: number[] = [];
  const minGap = (0.4 * track.length) / rows;
  for (let row = 0; row < rows; row++) {
    const target = ((row + 0.5) / rows) * track.length;
    const window = (0.45 * track.length) / rows;
    let best = -1;
    let bestScore = Infinity;
    for (let s = target - window; s <= target + window; s += step * 2) {
      if (s < 150 || s > track.length - 80) continue;
      if (chosen.some((c) => Math.min(Math.abs(c - s), track.length - Math.abs(c - s)) < minGap)) continue;
      const i = Math.floor(s / step) % n;
      const t = samples[i];
      // Somewhere another part of the track runs close (or crosses): skip.
      const hit = track.query(t.x, t.y);
      if (!hit || Math.min(Math.abs(hit.s - t.s), track.length - Math.abs(hit.s - t.s)) > 20) continue;
      const score = bendiness(i) + (0.002 * Math.abs(s - target)) / window;
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    }
    if (best < 0) continue;
    const t = samples[best];
    chosen.push(t.s);
    const count = Math.max(3, Math.min(5, Math.round((2 * t.halfWidth) / 4.5)));
    for (let k = 0; k < count; k++) {
      const d = (k / (count - 1) - 0.5) * 2 * t.halfWidth * 0.75;
      out.push({ x: t.x + t.nx * d, y: t.y + t.ny * d, index: best, respawnAt: 0 });
    }
  }
  return out;
}

/** Item effects on a car this step, after the world has set its power and drag. */
export function applyItemEffects(s: ItemState, car: Car, dt: number): void {
  car.push = 0;
  if (s.boost > 0) {
    car.push += BOOST_PUSH;
    car.dragFactor *= 0.7;
    s.boost = Math.max(0, s.boost - dt);
  }
  if (s.star > 0) {
    car.push += STAR_PUSH;
    car.dragFactor *= 0.85;
    s.star = Math.max(0, s.star - dt);
  }
  if (s.hooked > 0) {
    car.push -= HOOK_PULL;
    s.hooked = Math.max(0, s.hooked - dt);
    if (s.hooked === 0) s.hookedBy = null;
  }
  if (s.slip > 0) {
    car.gripFactor *= SLIP_GRIP;
    car.push -= SLIP_DRAG;
    s.slip = Math.max(0, s.slip - dt);
  }
}

/** Are two cars (about) touching? Measured in a's frame, as two boxes side by side. */
function touching(a: Car, b: Car): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const along = Math.abs(dx * Math.cos(a.heading) + dy * Math.sin(a.heading));
  const across = Math.abs(-dx * Math.sin(a.heading) + dy * Math.cos(a.heading));
  return along < a.params.length + 0.3 && across < a.params.width + 0.3;
}

/** Small deterministic random numbers (same on every run, for tests). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Item odds by place: `back` is 0 for the leader, 1 for last. The leader gets boosts and
 * rockets; the further back, the more hooks and rainbows.
 */
export function itemOdds(back: number): Record<ItemKind, number> {
  // Things to drop behind you are for defending: mostly at the front.
  return { boost: 3, rocket: 3 - back, hook: back > 0 ? 1 + 3 * back : 0, star: 3.5 * back, oil: 2.5 - 1.5 * back, barrier: 2.5 - 1.5 * back };
}

export function rollItem(back: number, random: number): ItemKind {
  const odds = itemOdds(back);
  const total = ITEM_KINDS.reduce((sum, k) => sum + odds[k], 0);
  let x = random * total;
  for (const k of ITEM_KINDS) {
    x -= odds[k];
    if (x < 0) return k;
  }
  return 'boost';
}

/** Boxes, held items and rockets for a party race. Runs on the host. */
export class ItemSystem {
  readonly boxes: ItemBox[];
  rockets: Rocket[] = [];
  drops: Drop[] = [];
  /** Messages for drivers (hooked someone, got hooked), taken by the session each step. */
  notes: { racerId: string; text: string }[] = [];
  private readonly random: () => number;

  constructor(private readonly track: Track) {
    this.boxes = placeItemBoxes(track);
    this.random = rng(Math.round(track.length));
  }

  view(time: number): ItemView {
    return {
      boxes: this.boxes.filter((b) => time >= b.respawnAt),
      rockets: this.rockets.map((m) => ({ x: m.x, y: m.y, heading: m.heading })),
      drops: this.drops.map((d) => ({ kind: d.kind, x: d.x, y: d.y, heading: d.heading })),
    };
  }

  /** Can this car pick up and use items now (racing, not in the pits or out of the race)? */
  private active(r: Racer): boolean {
    return !r.frozen && !r.car.retired && r.pit.phase === 'out';
  }

  step(racers: readonly Racer[], time: number, dt: number): ItemHit[] {
    const hits: ItemHit[] = [];
    const order = [...racers].sort((a, b) => raceProgress(b, this.track.length) - raceProgress(a, this.track.length));
    for (const r of racers) {
      const pressed = r.input.useItem === true;
      const press = pressed && !r.items.wasPressed;
      r.items.wasPressed = pressed;
      if (!this.active(r)) continue;
      // Through a box: it breaks either way, but you only get an item with your hands free.
      for (const b of this.boxes) {
        if (time < b.respawnAt || Math.hypot(b.x - r.car.x, b.y - r.car.y) > PICKUP_RADIUS) continue;
        b.respawnAt = time + BOX_RESPAWN;
        if (r.items.held === null) {
          const back = order.length > 1 ? order.indexOf(r) / (order.length - 1) : 0;
          r.items.held = rollItem(back, this.random());
        }
      }
      if (press && r.items.held) this.use(r, order, time);
    }
    this.moveRockets(racers, time, dt, hits);
    this.hitDrops(racers, time, hits);
    // A rainbow car spins out anyone it touches.
    for (const r of racers) {
      if (r.items.star <= 0 || !this.active(r)) continue;
      for (const o of racers) {
        if (o === r || o.items.star > 0 || !this.active(o)) continue;
        if (touching(r.car, o.car)) hits.push({ victim: o, by: r, how: 'star' });
      }
    }
    return hits;
  }

  private use(r: Racer, order: Racer[], time: number): void {
    const item = r.items.held!;
    const car = r.car;
    if (item === 'boost') r.items.boost = BOOST_TIME;
    else if (item === 'star') r.items.star = STAR_TIME;
    else if (item === 'rocket') {
      const nose = car.params.length / 2 + 2;
      this.rockets.push({
        x: car.x + Math.cos(car.heading) * nose,
        y: car.y + Math.sin(car.heading) * nose,
        heading: car.heading,
        speed: Math.max(0, car.forwardSpeed) + ROCKET_EXTRA_SPEED,
        index: car.trackIndex,
        owner: r.id,
        until: time + ROCKET_LIFE,
      });
    } else if (item === 'oil' || item === 'barrier') {
      this.drops.push({
        kind: item,
        x: car.x - Math.cos(car.heading) * DROP_BEHIND,
        y: car.y - Math.sin(car.heading) * DROP_BEHIND,
        heading: car.heading,
        owner: r.id,
        armedAt: time + DROP_ARM,
        until: time + DROP_LIFE,
      });
      if (this.drops.length > MAX_DROPS) this.drops.shift();
    } else {
      // Hook: the next car up the road, if it's in reach. Without one, keep the item.
      const target = this.carAhead(r, order);
      if (!target) return;
      if (target.items.star <= 0) {
        target.items.hooked = HOOK_TIME;
        target.items.hookedBy = r.id;
        this.notes.push({ racerId: target.id, text: `Hooked by ${r.name}!` }, { racerId: r.id, text: `Hooked ${target.name}!` });
      }
    }
    r.items.held = null;
  }

  /** The car just ahead in the race (within HOOK_RANGE), still racing. */
  carAhead(r: Racer, order: Racer[]): Racer | null {
    const mine = raceProgress(r, this.track.length);
    let best: Racer | null = null;
    let bestGap = HOOK_RANGE;
    for (const o of order) {
      if (o === r || !this.active(o)) continue;
      const gap = raceProgress(o, this.track.length) - mine;
      if (gap > 0 && gap < bestGap) {
        bestGap = gap;
        best = o;
      }
    }
    return best;
  }

  /** Cars running into dropped items. Each one is used up by the first car to hit it. */
  private hitDrops(racers: readonly Racer[], time: number, hits: ItemHit[]): void {
    this.drops = this.drops.filter((d) => {
      if (time > d.until) return false;
      for (const r of racers) {
        if (!this.active(r) || Math.hypot(r.car.x - d.x, r.car.y - d.y) > DROP_RADIUS) continue;
        // The car that dropped it gets a moment to drive away from it.
        if (r.id === d.owner && time < d.armedAt) continue;
        // A rainbow car just smashes through.
        if (r.items.star > 0) return false;
        const owner = racers.find((o) => o.id === d.owner) ?? r;
        const whose = owner === r ? 'your own' : `${owner.name}'s`;
        if (d.kind === 'barrier') hits.push({ victim: r, by: owner, how: 'barrier' });
        else {
          r.items.slip = SLIP_TIME;
          this.notes.push({ racerId: r.id, text: `Slid on ${whose} oil!` });
          if (owner !== r) this.notes.push({ racerId: owner.id, text: `${r.name} slid on your oil!` });
        }
        return false;
      }
      return true;
    });
  }

  private moveRockets(racers: readonly Racer[], time: number, dt: number, hits: ItemHit[]): void {
    this.rockets = this.rockets.filter((m) => {
      if (time > m.until) return false;
      // Small steps, so a fast rocket can't jump through a car or a wall.
      const steps = Math.ceil((m.speed * dt) / 1.5);
      for (let k = 0; k < steps; k++) {
        m.x += (Math.cos(m.heading) * m.speed * dt) / steps;
        m.y += (Math.sin(m.heading) * m.speed * dt) / steps;
        const hit = this.track.query(m.x, m.y, m.index);
        m.index = hit?.index ?? null;
        if (!hit || this.track.wallContact(m.x, m.y, m.x, m.y, m.index)) return false;
        // A rocket that meets something dropped on the track: both are gone.
        const blocked = this.drops.findIndex((d) => Math.hypot(d.x - m.x, d.y - m.y) < DROP_RADIUS);
        if (blocked >= 0) {
          this.drops.splice(blocked, 1);
          return false;
        }
        for (const r of racers) {
          if (r.id === m.owner || !this.active(r)) continue;
          if (Math.hypot(r.car.x - m.x, r.car.y - m.y) > ROCKET_HIT_RADIUS) continue;
          // A rainbow car just shrugs it off.
          if (r.items.star <= 0) hits.push({ victim: r, by: racers.find((o) => o.id === m.owner) ?? r, how: 'rocket' });
          return false;
        }
      }
      return true;
    });
  }
}
