import type { Car, ShedPart } from '../physics/car';
import type { Track } from '../track/track';
import type { Compound } from './tyres';

/**
 * Parts knocked off a car in a big hit: front and rear wings, wheels and carbon fibre shards.
 * They fly off with the car's speed, bounce along the road and off the walls, and lie on the
 * track for DEBRIS_LIFE seconds. Cars that run over them take a little damage (a wheel can
 * unsettle the car) and knock them on; bots steer round them. The host simulates them; clients
 * get them in each snapshot and only move them on between snapshots.
 */

export type DebrisKind = ShedPart['kind'];
/** Order matters: sent over the network by index. */
export const DEBRIS_KINDS: DebrisKind[] = ['frontWing', 'rearWing', 'wheel', 'shard'];

/** Seconds a piece lies on the track before it's cleared (it fades out over the last DEBRIS_FADE). */
export const DEBRIS_LIFE = 30;
export const DEBRIS_FADE = 2;
/** Oldest pieces are cleared first beyond this many. */
export const MAX_DEBRIS = 48;
/** Pieces flying higher than this (m) pass over the cars. */
const HIT_HEIGHT = 0.8;
/** A car only takes damage from the same piece once in this long (s). */
const HIT_COOLDOWN = 0.8;
/** Hits slower than this (m/s) just nudge the piece along, no damage. */
const HARMLESS_SPEED = 6;
const G = 9.81;

export interface DebrisSpec {
  /** Contact radius (m) round each probe point. */
  radius: number;
  /** Probe points along the piece, across its heading (m): a wing is long and thin. */
  span: number[];
  mass: number;
  /** Sliding deceleration on the road (m/s^2); grass and gravel stop it 3x quicker. */
  friction: number;
  /** Share of the speed kept bouncing off the ground, a wall or a car. */
  bounce: number;
  /** Front wing damage to a car that hits it flat out, and how much it unsettles the car. */
  damage: number;
  upset: number;
  /** Worth steering round (bots), worth drawing big. */
  hazard: boolean;
}

export const DEBRIS_SPEC: Record<DebrisKind, DebrisSpec> = {
  frontWing: { radius: 0.3, span: [-0.7, 0, 0.7], mass: 8, friction: 6, bounce: 0.3, damage: 0.12, upset: 0.15, hazard: true },
  rearWing: { radius: 0.3, span: [-0.4, 0, 0.4], mass: 7, friction: 6.5, bounce: 0.3, damage: 0.1, upset: 0.15, hazard: true },
  wheel: { radius: 0.36, span: [0], mass: 20, friction: 2.2, bounce: 0.5, damage: 0.22, upset: 0.55, hazard: true },
  shard: { radius: 0.15, span: [0], mass: 0.3, friction: 8, bounce: 0.2, damage: 0, upset: 0, hazard: false },
};

export interface Debris {
  id: number;
  kind: DebrisKind;
  /** The car it came off (for its paint). */
  owner: string;
  /** Wheels: the tyres it was wearing. */
  compound: Compound | null;
  x: number;
  y: number;
  /** Height above the road (m), and climb rate. */
  z: number;
  vx: number;
  vy: number;
  vz: number;
  heading: number;
  /** Spin (rad/s). */
  spin: number;
  /** World time it came off. */
  born: number;
  /** Where on the track it is (sample index), and its lap distance / offset across (for bots). */
  trackIndex: number | null;
  s: number;
  d: number;
  /** Host only: when each car last took damage from it. */
  hits?: Map<string, number>;
}

/** Stable pseudo-random 0..1 from two numbers, so the host's debris is the same every run. */
function rand(a: number, b: number): number {
  let h = Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca77);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return ((h >>> 0) % 10007) / 10007;
}

/** A part coming off a car: where and how fast it goes. */
export function spawnDebris(track: Track, car: Car, owner: string, compound: Compound, part: ShedPart, id: number, time: number): Debris {
  const c = Math.cos(car.heading);
  const s = Math.sin(car.heading);
  const rx = c * part.localX - s * part.localY;
  const ry = s * part.localX + c * part.localY;
  // The car's speed at that point, plus a kick outwards from the middle of the car.
  const pvx = car.vx - car.yawRate * ry;
  const pvy = car.vy + car.yawRate * rx;
  const r1 = rand(id, Math.round(time * 1000));
  const r2 = rand(id * 7 + 3, Math.round(part.speed * 100));
  const r3 = rand(id * 13 + 5, Math.round(car.x * 10));
  const out = Math.hypot(rx, ry) > 0.2 ? Math.atan2(ry, rx) : car.heading + Math.PI * (r1 * 2 - 1);
  const angle = out + (r1 - 0.5) * 1.4;
  const kind = part.kind;
  const keep = kind === 'wheel' ? 0.9 : kind === 'shard' ? 0.7 : 0.8;
  const kick = part.speed * (kind === 'wheel' ? 0.35 : kind === 'shard' ? 0.25 + 0.3 * r2 : 0.25);
  const vz = Math.min(9, kind === 'wheel' ? 2 + 0.25 * part.speed : kind === 'shard' ? 1.5 + 3 * r2 : 1 + 0.12 * part.speed);
  const spinMax = kind === 'wheel' ? 6 : kind === 'shard' ? 20 : 8;
  const x = car.x + rx;
  const y = car.y + ry;
  const q = track.query(x, y, car.trackIndex);
  return {
    id,
    kind,
    owner,
    compound: kind === 'wheel' ? compound : null,
    x,
    y,
    z: 0.3,
    vx: pvx * keep + Math.cos(angle) * kick,
    vy: pvy * keep + Math.sin(angle) * kick,
    vz,
    heading: kind === 'shard' ? r3 * Math.PI * 2 : car.heading,
    spin: (r3 * 2 - 1) * spinMax,
    born: time,
    trackIndex: q?.index ?? car.trackIndex,
    s: q?.s ?? 0,
    d: q?.d ?? 0,
    hits: new Map(),
  };
}

/** One step of a piece's flight and slide: gravity, bounces, road friction and the walls. */
export function moveDebris(track: Track, p: Debris, dt: number): void {
  const spec = DEBRIS_SPEC[p.kind];
  if (p.z > 0 || p.vz > 0) {
    p.vz -= G * dt;
    p.z += p.vz * dt;
    if (p.z <= 0) {
      p.z = 0;
      // Bounce while it lands hard; a wheel keeps hopping along for a while.
      p.vz = p.vz < -1.5 ? -p.vz * spec.bounce : 0;
      p.spin *= 0.8;
    }
  }
  const speed = Math.hypot(p.vx, p.vy);
  if (speed === 0) return;
  if (p.z === 0) {
    const surface = track.surfaceAt(p.x, p.y, p.trackIndex).type;
    const rough = surface === 'grass' || surface === 'gravel';
    const slow = spec.friction * (rough ? 3 : 1) * dt;
    const k = speed > slow ? (speed - slow) / speed : 0;
    p.vx *= k;
    p.vy *= k;
    p.spin *= Math.exp(-3 * dt);
  }
  p.x += p.vx * dt;
  p.y += p.vy * dt;
  p.heading += p.spin * dt;
  if (Math.abs(p.spin) < 0.05) p.spin = 0;
  const q = track.query(p.x, p.y, p.trackIndex);
  if (q) {
    p.trackIndex = q.index;
    p.s = q.s;
    p.d = q.d;
  }
  const wall = track.wallContact(p.x, p.y, p.x, p.y, p.trackIndex);
  if (wall) {
    p.x += wall.nx * wall.depth;
    p.y += wall.ny * wall.depth;
    const vn = p.vx * wall.nx + p.vy * wall.ny;
    if (vn < 0) {
      p.vx -= (1 + spec.bounce) * vn * wall.nx;
      p.vy -= (1 + spec.bounce) * vn * wall.ny;
      p.spin += vn * 0.5 * (p.id % 2 ? 1 : -1);
    }
  }
}

/** Is this piece still on the track at this time? */
export function debrisAlive(p: Debris, time: number): boolean {
  return time - p.born < DEBRIS_LIFE;
}

/** How visible a piece is (1, fading to 0 at the end of its life). */
export function debrisOpacity(p: Debris, time: number): number {
  return Math.max(0, Math.min(1, (DEBRIS_LIFE - (time - p.born)) / DEBRIS_FADE));
}

export interface DebrisHit {
  kind: DebrisKind;
  /** Closing speed (m/s). */
  speed: number;
}

/**
 * A car running into a piece: the piece is knocked on (up into the air if hit fast), and a hit
 * above walking pace damages the car where it touched (the front wing, mostly). A wheel hit
 * hard unsettles the car and kicks it sideways. Returns the hit if it did damage.
 */
export function collideCarDebris(car: Car, carId: string, p: Debris, time: number): DebrisHit | null {
  const spec = DEBRIS_SPEC[p.kind];
  if (p.z > HIT_HEIGHT) return null;
  if (Math.abs(p.x - car.x) > 5 || Math.abs(p.y - car.y) > 5) return null;
  const hl = car.params.length / 2;
  const hw = car.params.width / 2;
  const c = Math.cos(car.heading);
  const s = Math.sin(car.heading);
  // Probe points along the piece (across its heading).
  const px = -Math.sin(p.heading);
  const py = Math.cos(p.heading);
  for (const k of spec.span) {
    const wx = p.x + px * k - car.x;
    const wy = p.y + py * k - car.y;
    const lx = wx * c + wy * s;
    const ly = -wx * s + wy * c;
    // Nearest point of the car's box, and the way out from it.
    const cx = Math.max(-hl, Math.min(hl, lx));
    const cy = Math.max(-hw, Math.min(hw, ly));
    let nlx = lx - cx;
    let nly = ly - cy;
    let dist = Math.hypot(nlx, nly);
    if (dist > spec.radius) continue;
    if (dist < 1e-6) {
      // Inside the box: out through the nearest face.
      const fx = hl - Math.abs(lx);
      const fy = hw - Math.abs(ly);
      if (fx < fy) [nlx, nly] = [Math.sign(lx) || 1, 0];
      else [nlx, nly] = [0, Math.sign(ly) || 1];
      dist = 0;
    } else {
      nlx /= dist;
      nly /= dist;
    }
    const nx = nlx * c - nly * s;
    const ny = nlx * s + nly * c;
    // The car's speed at the touching point, against the piece's.
    const rx = cx * c - cy * s;
    const ry = cx * s + cy * c;
    const vcx = car.vx - car.yawRate * ry;
    const vcy = car.vy + car.yawRate * rx;
    const rel = (vcx - p.vx) * nx + (vcy - p.vy) * ny;
    // Push the piece clear of the car either way.
    p.x += nx * (spec.radius - dist);
    p.y += ny * (spec.radius - dist);
    if (rel <= 0) return null;
    // Knocked on: the piece is tiny next to the car, so it takes the car's speed and then some.
    const dv = (1 + spec.bounce) * rel;
    p.vx += nx * dv + (vcx - p.vx - rel * nx) * 0.3;
    p.vy += ny * dv + (vcy - p.vy - rel * ny) * 0.3;
    p.vz = Math.max(p.vz, Math.min(7, rel * 0.12));
    p.z = Math.max(p.z, 0.01);
    p.spin += (p.id % 2 ? 1 : -1) * Math.min(15, rel * 0.3);
    const share = spec.mass / car.params.mass;
    car.vx -= nx * dv * share;
    car.vy -= ny * dv * share;
    if (rel < HARMLESS_SPEED || spec.damage === 0) return null;
    const hits = (p.hits ??= new Map());
    const last = hits.get(carId);
    hits.set(carId, time);
    if (last !== undefined && time - last < HIT_COOLDOWN) return null;
    const severity = Math.min(1, (rel - HARMLESS_SPEED) / 50);
    car.hitDebris(cx, cy, spec.damage * severity, spec.upset * severity);
    // A wheel under the car throws it sideways a little.
    car.yawRate += (ly >= 0 ? -1 : 1) * spec.upset * severity * 1.5;
    return { kind: p.kind, speed: rel };
  }
  return null;
}
