import type { Car } from '../physics/car';
import type { Track } from '../track/track';
import { Tyres } from './tyres';
import { raceProgress, type Racer } from './world';

/**
 * Party mode: Mario Kart style item boxes on an otherwise normal race.
 * Rows of boxes sit across the track on straights; driving through one gives a random item
 * (if you aren't holding one already), and the box comes back a few seconds later.
 * The further back you are, the better the odds of the strong items.
 */
export type ItemKind =
  | 'boost'
  | 'rocket'
  | 'triple'
  | 'homing'
  | 'blue'
  | 'hook'
  | 'magnet'
  | 'lightning'
  | 'teleport'
  | 'star'
  | 'shield'
  | 'ghost'
  | 'oil'
  | 'barrier'
  | 'mine'
  | 'smoke'
  | 'tyres';
export const ITEM_KINDS: ItemKind[] = [
  'boost',
  'rocket',
  'triple',
  'homing',
  'blue',
  'hook',
  'magnet',
  'lightning',
  'teleport',
  'star',
  'shield',
  'ghost',
  'oil',
  'barrier',
  'mine',
  'smoke',
  'tyres',
];
/** Items dropped behind the car, which stay on the track until someone hits them (smoke: until it clears). */
export type DropKind = 'oil' | 'barrier' | 'mine' | 'smoke';
/** Things in flight: a rocket flies straight; homing rockets and blue shells follow the track to their target. */
export type MissileKind = 'rocket' | 'homing' | 'blue';

export const ITEM_INFO: Record<ItemKind, { name: string; color: string }> = {
  boost: { name: 'Boost', color: '#ffb000' },
  rocket: { name: 'Rocket', color: '#ff4136' },
  triple: { name: 'Triple rockets', color: '#ff4136' },
  homing: { name: 'Homing rocket', color: '#ff66aa' },
  blue: { name: 'Blue shell', color: '#2f7bff' },
  hook: { name: 'Hook', color: '#2ecc40' },
  magnet: { name: 'Magnet', color: '#4fc3ff' },
  lightning: { name: 'Lightning', color: '#ffe23d' },
  teleport: { name: 'Teleport', color: '#b84dff' },
  star: { name: 'Rainbow', color: '#ff66ff' },
  shield: { name: 'Shield', color: '#7fdbff' },
  ghost: { name: 'Ghost', color: '#d0d0ff' },
  oil: { name: 'Oil slick', color: '#8a7cff' },
  barrier: { name: 'Tyre barrier', color: '#ff8c1a' },
  mine: { name: 'Mine', color: '#ff4136' },
  smoke: { name: 'Smoke screen', color: '#aaaaaa' },
  tyres: { name: 'Fresh tyres', color: '#e10600' },
};

/** A box comes back this long (s) after it is picked up. */
export const BOX_RESPAWN = 4;
/** A car picks up a box this close to its centre (m). */
const PICKUP_RADIUS = 2.8;
/** Boost: a straight shove forwards, and less drag, so it beats the normal top speed. */
export const BOOST_TIME = 2.5;
const BOOST_PUSH = 14000;
/** Rainbow: a longer, gentler boost; nothing can hurt you and anyone you touch spins out. */
export const STAR_TIME = 6;
const STAR_PUSH = 3500;
/** Hook: the car ahead is pulled back towards you. */
export const HOOK_TIME = 1.5;
const HOOK_PULL = 7000;
/** How far ahead (m of race distance) the hook, magnet, homing rocket and teleport reach. */
export const HOOK_RANGE = 250;
export const MAGNET_RANGE = 200;
export const HOMING_RANGE = 600;
export const TELEPORT_RANGE = 500;
/** Magnet: you're drawn towards the car ahead (a slipstream on steroids). */
export const MAGNET_TIME = 3;
const MAGNET_PUSH = 6000;
/** Lightning: every car ahead of you slows for a moment. */
export const ZAP_TIME = 2;
const ZAP_PULL = 6000;
/** Shield: blocks the next hit, for up to this long. */
export const SHIELD_TIME = 12;
/** Ghost: see-through and untouchable (cars too) for a moment, and steals someone's item. */
export const GHOST_TIME = 4;
/** Teleport lands this far behind the car ahead (and never past a timing line). */
const TELEPORT_BEHIND = 15;
/** Rockets fly straight at this much more than the car's speed, until a wall, a car or timeout. */
const ROCKET_EXTRA_SPEED = 45;
const ROCKET_LIFE = 4;
const ROCKET_HIT_RADIUS = 2.6;
/** Homing rockets and blue shells follow the track, a good bit faster than their target. */
const HOMING_EXTRA_SPEED = 30;
const BLUE_SPEED = 110;
const HOMING_LIFE = 12;
/** How fast (m/s) a homing rocket moves across the track to line up with its target. */
const HOMING_STEER = 12;
/** A car hit by a rocket (or a rainbow car, a barrier, a mine) stops and restarts after this long (s). */
export const KNOCKOUT_WAIT = 2;
/** Dropped items: placed this far behind the car's centre; the car that dropped one can't hit it for a moment. */
const DROP_BEHIND = 5.5;
const DROP_ARM = 0.7;
const DROP_RADIUS = 2.4;
/** A mine goes off for anyone this close. */
export const MINE_RADIUS = 5;
/** Smoke: a big cloud that hides cars in it, for a while. */
export const SMOKE_RADIUS = 13;
const SMOKE_LIFE = 8;
/** Dropped items clear themselves after this long (s), and at most this many lie on the track. */
const DROP_LIFE = 90;
const MAX_DROPS = 24;
/** Oil: the car slides (little grip) and loses speed for a moment. */
export const SLIP_TIME = 1.4;
const SLIP_GRIP = 0.3;
const SLIP_DRAG = 3000;

export interface ItemState {
  held: ItemKind | null;
  /** Shots left of a multi-shot item (triple rockets). */
  charges: number;
  /** Seconds left of each effect. */
  boost: number;
  star: number;
  hooked: number;
  /** Who hooked this car (for drawing the line). */
  hookedBy: string | null;
  /** On oil: seconds of sliding left. */
  slip: number;
  shield: number;
  /** Struck by lightning: slowed. */
  zap: number;
  magnet: number;
  /** The car the magnet pulls towards (for drawing the line). */
  magnetTo: string | null;
  ghost: number;
  /** The use button was down last step (items fire on the press, not while held). */
  wasPressed: boolean;
}

export function newItemState(): ItemState {
  return {
    held: null,
    charges: 0,
    boost: 0,
    star: 0,
    hooked: 0,
    hookedBy: null,
    slip: 0,
    shield: 0,
    zap: 0,
    magnet: 0,
    magnetTo: null,
    ghost: 0,
    wasPressed: false,
  };
}

/** Nothing can hurt this car right now (rainbow or ghost). */
export function untouchable(s: ItemState): boolean {
  return s.star > 0 || s.ghost > 0;
}

export interface ItemBox {
  x: number;
  y: number;
  /** Track sample the box sits on. */
  index: number;
  /** Simulation time it is back (it's there when time >= respawnAt). */
  respawnAt: number;
}

export interface Missile {
  kind: MissileKind;
  x: number;
  y: number;
  heading: number;
  speed: number;
  /** Track sample it is over (hint for wall checks). */
  index: number | null;
  owner: string;
  until: number;
  /** Homing / blue: the car it chases, and where it is along (lap distance) and across the track. */
  target: string | null;
  s: number;
  d: number;
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

/** What to draw: boxes that are there now, things in flight and items dropped on the track. */
export interface ItemView {
  boxes: { x: number; y: number }[];
  rockets: { kind: MissileKind; x: number; y: number; heading: number }[];
  drops: { kind: DropKind; x: number; y: number; heading: number; owner: string }[];
}

/** Someone was taken out by an item. */
export interface ItemHit {
  victim: Racer;
  by: Racer;
  how: 'rocket' | 'homing' | 'blue' | 'star' | 'barrier' | 'mine';
}

/** What each way of being taken out is called in messages. */
export const HIT_NAMES: Record<ItemHit['how'], string> = {
  rocket: 'rocket',
  homing: 'homing rocket',
  blue: 'blue shell',
  star: 'rainbow',
  barrier: 'tyre barrier',
  mine: 'mine',
};

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

/** Item effects on a car this step, after the world has set its power, drag and grip. */
export function applyItemEffects(s: ItemState, car: Car, dt: number): void {
  car.push = 0;
  const tick = (v: number) => Math.max(0, v - dt);
  if (s.boost > 0) {
    car.push += BOOST_PUSH;
    car.dragFactor *= 0.7;
    s.boost = tick(s.boost);
  }
  if (s.star > 0) {
    car.push += STAR_PUSH;
    car.dragFactor *= 0.85;
    s.star = tick(s.star);
  }
  if (s.magnet > 0) {
    car.push += MAGNET_PUSH;
    car.dragFactor *= 0.8;
    s.magnet = tick(s.magnet);
    if (s.magnet === 0) s.magnetTo = null;
  }
  if (s.hooked > 0) {
    car.push -= HOOK_PULL;
    s.hooked = tick(s.hooked);
    if (s.hooked === 0) s.hookedBy = null;
  }
  if (s.zap > 0) {
    car.push -= ZAP_PULL;
    s.zap = tick(s.zap);
  }
  if (s.slip > 0) {
    car.gripFactor *= SLIP_GRIP;
    car.push -= SLIP_DRAG;
    s.slip = tick(s.slip);
  }
  s.shield = tick(s.shield);
  s.ghost = tick(s.ghost);
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
 * Item odds by place: `back` is 0 for the leader, 1 for last. The front runners get boosts,
 * rockets and things to defend with; further back, the items that catch up: hooks, magnets,
 * homing rockets, rainbows, and (rarely, near the back) lightning, blue shells and teleports.
 */
export function itemOdds(back: number): Record<ItemKind, number> {
  const chasing = back > 0 ? 1 : 0;
  return {
    boost: 3,
    rocket: 3 - back,
    triple: 0.3 + 1.2 * back,
    homing: chasing * (0.3 + 1.5 * back),
    blue: chasing * 1.2 * back,
    hook: chasing * (1 + 2 * back),
    magnet: chasing * (0.8 + 1.5 * back),
    lightning: 1.5 * back * back,
    teleport: back > 0.5 ? 3 * (back - 0.5) : 0,
    star: 3 * back,
    shield: 2.5 - 1.5 * back,
    ghost: chasing * 1.2 * back,
    oil: 2.5 - 1.5 * back,
    barrier: 2.5 - 1.5 * back,
    mine: 1.5 - 0.8 * back,
    smoke: 1.5 - 0.8 * back,
    tyres: 1,
  };
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

/** Boxes, held items and everything in flight or on the track for a party race. Runs on the host. */
export class ItemSystem {
  readonly boxes: ItemBox[];
  rockets: Missile[] = [];
  drops: Drop[] = [];
  /** Messages for drivers (hooked someone, got hooked, shield blocked...), taken by the session each step. */
  notes: { racerId: string; text: string }[] = [];
  private readonly random: () => number;

  constructor(private readonly track: Track) {
    this.boxes = placeItemBoxes(track);
    this.random = rng(Math.round(track.length));
  }

  view(time: number): ItemView {
    return {
      boxes: this.boxes.filter((b) => time >= b.respawnAt),
      rockets: this.rockets.map((m) => ({ kind: m.kind, x: m.x, y: m.y, heading: m.heading })),
      drops: this.drops.map((d) => ({ kind: d.kind, x: d.x, y: d.y, heading: d.heading, owner: d.owner })),
    };
  }

  /** Can this car pick up and use items now (racing, not in the pits or out of the race)? */
  private active(r: Racer): boolean {
    return !r.frozen && !r.car.retired && r.pit.phase === 'out';
  }

  /**
   * Does something bad (`what`, for the message) get through to this car? Not with a rainbow
   * or a ghost; a shield stops it once and is used up.
   */
  private protectedFrom(r: Racer, what: string): boolean {
    if (untouchable(r.items)) return true;
    if (r.items.shield > 0) {
      r.items.shield = 0;
      this.notes.push({ racerId: r.id, text: `Shield blocked ${what}!` });
      return true;
    }
    return false;
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
          this.give(r, rollItem(back, this.random()));
        }
      }
      if (press && r.items.held) this.use(r, racers, order, time);
    }
    this.moveMissiles(racers, time, dt, hits);
    this.hitDrops(racers, time, hits);
    // A rainbow car spins out anyone it touches.
    for (const r of racers) {
      if (r.items.star <= 0 || !this.active(r)) continue;
      for (const o of racers) {
        if (o === r || !this.active(o) || !touching(r.car, o.car)) continue;
        if (!this.protectedFrom(o, `${r.name}'s rainbow`)) hits.push({ victim: o, by: r, how: 'star' });
      }
    }
    return hits;
  }

  private give(r: Racer, item: ItemKind): void {
    r.items.held = item;
    r.items.charges = item === 'triple' ? 3 : 1;
  }

  /** Use the held item. Some (hook, magnet, teleport, blue shell) wait for a target and are kept until there is one. */
  private use(r: Racer, racers: readonly Racer[], order: Racer[], time: number): void {
    const item = r.items.held!;
    const car = r.car;
    switch (item) {
      case 'boost':
        r.items.boost = BOOST_TIME;
        break;
      case 'star':
        r.items.star = STAR_TIME;
        break;
      case 'shield':
        r.items.shield = SHIELD_TIME;
        break;
      case 'tyres':
        // A fresh set of the same compound (a different one would dodge the two-compound rule).
        r.tyres = new Tyres(r.tyres.compound);
        this.notes.push({ racerId: r.id, text: 'Fresh tyres!' });
        break;
      case 'rocket':
      case 'triple':
        this.fire(r, 'rocket', null, time);
        break;
      case 'homing': {
        const target = this.carAhead(r, order, HOMING_RANGE);
        if (!target) return;
        this.fire(r, 'homing', target, time);
        break;
      }
      case 'blue': {
        const leader = order.find((o) => this.active(o));
        if (!leader || leader === r) return;
        this.fire(r, 'blue', leader, time);
        this.notes.push({ racerId: leader.id, text: `${r.name}'s blue shell is coming for you!` });
        break;
      }
      case 'hook': {
        const target = this.carAhead(r, order, HOOK_RANGE);
        if (!target) return;
        if (!this.protectedFrom(target, `${r.name}'s hook`)) {
          target.items.hooked = HOOK_TIME;
          target.items.hookedBy = r.id;
          this.notes.push({ racerId: target.id, text: `Hooked by ${r.name}!` }, { racerId: r.id, text: `Hooked ${target.name}!` });
        }
        break;
      }
      case 'magnet': {
        const target = this.carAhead(r, order, MAGNET_RANGE);
        if (!target) return;
        r.items.magnet = MAGNET_TIME;
        r.items.magnetTo = target.id;
        break;
      }
      case 'lightning': {
        const mine = raceProgress(r, this.track.length);
        let struck = 0;
        for (const o of racers) {
          if (o === r || !this.active(o) || raceProgress(o, this.track.length) <= mine) continue;
          if (this.protectedFrom(o, `${r.name}'s lightning`)) continue;
          o.items.zap = ZAP_TIME;
          struck++;
          this.notes.push({ racerId: o.id, text: `Struck by ${r.name}'s lightning!` });
        }
        this.notes.push({ racerId: r.id, text: struck ? `Lightning struck ${struck} car${struck > 1 ? 's' : ''}!` : 'Lightning: nobody ahead to strike' });
        break;
      }
      case 'teleport':
        if (!this.teleport(r, order)) return;
        break;
      case 'ghost': {
        r.items.ghost = GHOST_TIME;
        r.items.held = null;
        // Steal someone's item, if anyone has one.
        const victims = racers.filter((o) => o !== r && o.items.held !== null);
        if (victims.length) {
          const v = victims[Math.floor(this.random() * victims.length)];
          r.items.held = v.items.held;
          r.items.charges = v.items.charges;
          this.notes.push({ racerId: v.id, text: `${r.name} stole your ${ITEM_INFO[v.items.held!].name.toLowerCase()}!` });
          this.notes.push({ racerId: r.id, text: `Stole ${v.name}'s ${ITEM_INFO[v.items.held!].name.toLowerCase()}!` });
          v.items.held = null;
          v.items.charges = 0;
        }
        return;
      }
      case 'oil':
      case 'barrier':
      case 'mine':
      case 'smoke':
        this.drops.push({
          kind: item,
          x: car.x - Math.cos(car.heading) * DROP_BEHIND,
          y: car.y - Math.sin(car.heading) * DROP_BEHIND,
          heading: car.heading,
          owner: r.id,
          armedAt: time + DROP_ARM,
          until: time + (item === 'smoke' ? SMOKE_LIFE : DROP_LIFE),
        });
        if (this.drops.length > MAX_DROPS) this.drops.shift();
        break;
    }
    r.items.charges--;
    if (r.items.charges <= 0) {
      r.items.held = null;
      r.items.charges = 0;
    }
  }

  private fire(r: Racer, kind: MissileKind, target: Racer | null, time: number): void {
    const car = r.car;
    const nose = car.params.length / 2 + 2;
    const x = car.x + Math.cos(car.heading) * nose;
    const y = car.y + Math.sin(car.heading) * nose;
    const hit = this.track.query(x, y, car.trackIndex);
    const own = Math.max(0, car.forwardSpeed);
    const speed =
      kind === 'rocket' ? own + ROCKET_EXTRA_SPEED : kind === 'blue' ? Math.max(BLUE_SPEED, own + 40) : Math.max(own, target?.car.speed ?? 0) + HOMING_EXTRA_SPEED;
    this.rockets.push({
      kind,
      x,
      y,
      heading: car.heading,
      speed,
      index: hit?.index ?? car.trackIndex,
      owner: r.id,
      until: time + (kind === 'rocket' ? ROCKET_LIFE : HOMING_LIFE),
      target: target?.id ?? null,
      s: hit?.s ?? 0,
      d: hit?.d ?? 0,
    });
  }

  /** The car just ahead in the race (within `range` m), still racing. */
  carAhead(r: Racer, order: Racer[], range: number): Racer | null {
    const mine = raceProgress(r, this.track.length);
    let best: Racer | null = null;
    let bestGap = range;
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

  /**
   * Jump to just behind the car ahead, at its speed. Never past the next timing line: a lap
   * only counts when the car crosses every line, so it stops short of one instead.
   */
  private teleport(r: Racer, order: Racer[]): boolean {
    const target = this.carAhead(r, order, TELEPORT_RANGE);
    if (!target) return false;
    const track = this.track;
    const here = track.query(r.car.x, r.car.y, r.car.trackIndex);
    const there = track.query(target.car.x, target.car.y, target.car.trackIndex);
    if (!here || !there) return false;
    const toLine = track.forwardDistance(here.s, r.timer.nextLine() % track.length);
    const jump = Math.min(track.forwardDistance(here.s, there.s) - TELEPORT_BEHIND, toLine - 3);
    if (jump < 10) return false;
    const n = track.samples.length;
    const index = Math.floor(((here.s + jump) % track.length) / (track.length / n)) % n;
    const t = track.samples[index];
    const d = Math.max(-0.7 * t.halfWidth, Math.min(0.7 * t.halfWidth, there.d));
    const heading = Math.atan2(t.ty, t.tx);
    const speed = Math.max(r.car.speed, target.car.speed);
    r.car.place(t.x + t.nx * d, t.y + t.ny * d, heading, index);
    r.car.vx = Math.cos(heading) * speed;
    r.car.vy = Math.sin(heading) * speed;
    this.notes.push({ racerId: r.id, text: `Teleported behind ${target.name}!` });
    return true;
  }

  /** Cars running into dropped items. Each one is used up by the first car to hit it (smoke just clears in time). */
  private hitDrops(racers: readonly Racer[], time: number, hits: ItemHit[]): void {
    this.drops = this.drops.filter((d) => {
      if (time > d.until) return false;
      if (d.kind === 'smoke') return true;
      const reach = d.kind === 'mine' ? MINE_RADIUS : DROP_RADIUS;
      for (const r of racers) {
        if (!this.active(r) || Math.hypot(r.car.x - d.x, r.car.y - d.y) > reach) continue;
        // The car that dropped it gets a moment to drive away from it.
        if (r.id === d.owner && time < d.armedAt) continue;
        // A ghost passes straight through; a rainbow car smashes it.
        if (r.items.ghost > 0) continue;
        if (r.items.star > 0) return false;
        const owner = racers.find((o) => o.id === d.owner) ?? r;
        const whose = owner === r ? 'your own' : `${owner.name}'s`;
        if (this.protectedFrom(r, `${whose} ${ITEM_INFO[d.kind].name.toLowerCase()}`)) return false;
        if (d.kind === 'oil') {
          r.items.slip = SLIP_TIME;
          this.notes.push({ racerId: r.id, text: `Slid on ${whose} oil!` });
          if (owner !== r) this.notes.push({ racerId: owner.id, text: `${r.name} slid on your oil!` });
        } else {
          hits.push({ victim: r, by: owner, how: d.kind });
        }
        return false;
      }
      return true;
    });
  }

  private moveMissiles(racers: readonly Racer[], time: number, dt: number, hits: ItemHit[]): void {
    this.rockets = this.rockets.filter((m) => {
      if (time > m.until) return false;
      const owner = racers.find((o) => o.id === m.owner);
      const target = m.target ? racers.find((o) => o.id === m.target) : undefined;
      // A homing rocket whose target is gone (pits, finished, knocked out) fizzles out.
      if (m.target && (!target || !this.active(target))) return false;
      // Small steps, so a fast rocket can't jump through a car or a wall.
      const steps = Math.ceil((m.speed * dt) / 1.5);
      for (let k = 0; k < steps; k++) {
        if (target) this.steer(m, target, dt / steps);
        else {
          m.x += (Math.cos(m.heading) * m.speed * dt) / steps;
          m.y += (Math.sin(m.heading) * m.speed * dt) / steps;
          const hit = this.track.query(m.x, m.y, m.index);
          m.index = hit?.index ?? null;
          if (!hit || this.track.wallContact(m.x, m.y, m.x, m.y, m.index)) return false;
          // A rocket that meets something dropped on the track: both are gone.
          const blocked = this.drops.findIndex((d) => d.kind !== 'smoke' && Math.hypot(d.x - m.x, d.y - m.y) < DROP_RADIUS);
          if (blocked >= 0) {
            this.drops.splice(blocked, 1);
            return false;
          }
        }
        // Straight rockets hit whoever they meet; homing ones only their target.
        for (const r of target ? [target] : racers) {
          if (r.id === m.owner || !this.active(r)) continue;
          if (Math.hypot(r.car.x - m.x, r.car.y - m.y) > ROCKET_HIT_RADIUS) continue;
          // A ghost lets a straight rocket fly on through.
          if (r.items.ghost > 0 && !target) continue;
          const whose = owner ? `${owner.name}'s` : 'a';
          if (!this.protectedFrom(r, `${whose} ${HIT_NAMES[m.kind]}`)) hits.push({ victim: r, by: owner ?? r, how: m.kind });
          return false;
        }
      }
      return true;
    });
  }

  /** Move a homing rocket along the track, lining up across it with its target. */
  private steer(m: Missile, target: Racer, dt: number): void {
    const track = this.track;
    const n = track.samples.length;
    m.s = (m.s + m.speed * dt) % track.length;
    const there = track.query(target.car.x, target.car.y, target.car.trackIndex);
    if (there) m.d += Math.max(-HOMING_STEER * dt, Math.min(HOMING_STEER * dt, there.d - m.d));
    const index = Math.floor(m.s / (track.length / n)) % n;
    const t = track.samples[index];
    m.index = index;
    m.x = t.x + t.nx * m.d;
    m.y = t.y + t.ny * m.d;
    m.heading = Math.atan2(t.ty, t.tx);
    // Close enough along the track and it can't miss (it's already level or just past).
    const ahead = there ? track.forwardDistance(m.s, there.s) : Infinity;
    if (Math.min(ahead, track.length - ahead) < 1.5) {
      m.x = target.car.x;
      m.y = target.car.y;
    }
  }
}
