import type { Car } from '../physics/car';
import type { Track } from '../track/track';
import type { Racer, TrailPoint } from './world';

const RESTITUTION = 0.2;
const FRICTION = 0.3;
/** Closing speed (m/s) below which contact is just racing: never judged (~40 km/h). */
const PENALTY_MIN_IMPACT = 11;
/** A hit this hard (~65 km/h closing) is penalised even the first time. */
const BIG_HIT = 18;
const CAR_IMPACT_SCALE = 0.6;
/** The same two cars can only be judged once in this many seconds. */
const PAIR_COOLDOWN = 3;
/** How far from each end of the car counts as its nose or gearbox (m). */
const END_ZONE = 1.2;
/** Cars this far apart sideways (centre to centre, m) are clear of each other: a car's width plus a little. */
const LATERAL_CLEAR = 2.3;
/** Sideways move (m) towards the other car that counts as moving across. */
const MOVE_MIN = 1;
/** How far back (s) from the last moment two cars were clear to look for who moved. */
const MOVE_WINDOW = 0.6;
/** Less time than this (s) between a car moving across in front and the hit: the car behind couldn't avoid it. */
const REACTION_TIME = 0.8;
/**
 * Only a car this close behind (centre to centre, m: about a car length between them) when the
 * car ahead moved across can have been cut off. Further back, it had room to react.
 */
const CUT_OFF_GAP = 11;
/** Coming up the inside this much faster (m/s) than the car turning in is a dive-bomb. */
const DIVE_BOMB_SPEED = 6;
/** Track curvature (1/m) below which a section counts as a straight. */
const STRAIGHT_CURVATURE = 1 / 200;
/** Moving backwards along the track faster than this (m/s) is driving the wrong way. */
const WRONG_WAY_SPEED = 3;
/**
 * Centres this far apart along the track (m) and the cars are nose to tail, not alongside:
 * the car behind can't claim it was squeezed.
 */
const IN_LINE_GAP = 4;

export type HitPart = 'front' | 'rear' | 'side';

export interface Contact {
  a: Racer;
  b: Racer;
  /** Closing speed along the contact normal (m/s). */
  impact: number;
  /** The driver judged to have caused it, if anyone. */
  atFault: Racer | null;
  /** Why, in a few words. */
  reason: string;
  /** 5 s when someone is at fault, 10 s if they wrecked the other car. */
  penalty: number;
  /** A big hit, or one that wrecked the other car: no warning first. */
  serious: boolean;
}

interface Box {
  cx: number;
  cy: number;
  /** Forward and right unit vectors. */
  fx: number;
  fy: number;
  hl: number;
  hw: number;
}

function box(c: Car): Box {
  return { cx: c.x, cy: c.y, fx: Math.cos(c.heading), fy: Math.sin(c.heading), hl: c.params.length / 2, hw: c.params.width / 2 };
}

function corners(b: Box): [number, number][] {
  const out: [number, number][] = [];
  for (const sl of [1, -1]) {
    for (const sw of [1, -1]) {
      out.push([b.cx + b.fx * b.hl * sl - b.fy * b.hw * sw, b.cy + b.fy * b.hl * sl + b.fx * b.hw * sw]);
    }
  }
  return out;
}

/** Half-length of a box projected onto an axis. */
function radius(b: Box, ax: number, ay: number): number {
  return Math.abs(b.fx * ax + b.fy * ay) * b.hl + Math.abs(-b.fy * ax + b.fx * ay) * b.hw;
}

/**
 * Separating-axis test between two car rectangles. Returns the push-out normal (from a
 * to b), the overlap depth and a contact point, or null if they don't touch.
 */
function overlap(a: Box, b: Box): { nx: number; ny: number; depth: number; px: number; py: number } | null {
  const dx = b.cx - a.cx;
  const dy = b.cy - a.cy;
  let best: { nx: number; ny: number; depth: number; fromA: boolean } | null = null;
  const axes: [number, number, boolean][] = [
    [a.fx, a.fy, true],
    [-a.fy, a.fx, true],
    [b.fx, b.fy, false],
    [-b.fy, b.fx, false],
  ];
  for (const [ax, ay, fromA] of axes) {
    const dist = dx * ax + dy * ay;
    const depth = radius(a, ax, ay) + radius(b, ax, ay) - Math.abs(dist);
    if (depth <= 0) return null;
    if (!best || depth < best.depth) {
      const s = dist >= 0 ? 1 : -1;
      best = { nx: ax * s, ny: ay * s, depth, fromA };
    }
  }
  if (!best) return null;
  // Contact point: the corner of the other box that pokes deepest along the normal.
  const pts = best.fromA ? corners(b) : corners(a);
  const pick = best.fromA
    ? pts.reduce((p, q) => (q[0] * best!.nx + q[1] * best!.ny < p[0] * best!.nx + p[1] * best!.ny ? q : p))
    : pts.reduce((p, q) => (q[0] * best!.nx + q[1] * best!.ny > p[0] * best!.nx + p[1] * best!.ny ? q : p));
  return { nx: best.nx, ny: best.ny, depth: best.depth, px: pick[0], py: pick[1] };
}

/** Which part of a car a world point is on. */
function partHit(c: Car, px: number, py: number): HitPart {
  const local = (px - c.x) * Math.cos(c.heading) + (py - c.y) * Math.sin(c.heading);
  const hl = c.params.length / 2;
  if (local > hl - END_ZONE) return 'front';
  if (local < -hl + END_ZONE) return 'rear';
  return 'side';
}

/**
 * Is the car driving the wrong way round the track? It has to be moving backwards: a car that
 * spun and sits facing the wrong way is a victim when it is hit, not a culprit.
 */
function wrongWay(track: Track, c: Car): boolean {
  const q = track.query(c.x, c.y, c.trackIndex);
  if (!q) return false;
  return c.vx * q.sample.tx + c.vy * q.sample.ty < -WRONG_WAY_SPEED;
}

export interface Verdict {
  atFault: Racer | null;
  /** Short reason shown with the penalty. */
  reason: string;
}

/**
 * Who moved across into whom, from the cars' recent track positions. Finds the last moment
 * the two cars were side by side with room between them, and which of them closed that
 * gap. Null if they were in line the whole time, or both moved.
 */
function lateralMove(
  track: Track,
  a: Racer,
  b: Racer,
  now: number,
): { mover: Racer; other: Racer; since: number; gap: number } | null {
  const ta = a.trail;
  const tb = b.trail;
  const da = track.query(a.car.x, a.car.y, a.car.trackIndex);
  const db = track.query(b.car.x, b.car.y, b.car.trackIndex);
  if (!da || !db) return null;
  let j = tb.length - 1;
  for (let i = ta.length - 1; i >= 0; i--) {
    const pa = ta[i];
    while (j > 0 && tb[j].t > pa.t) j--;
    const pb = tb[j];
    if (pb.t !== pa.t) continue;
    if (Math.abs(pa.d - pb.d) <= LATERAL_CLEAR) continue;
    // Clear of each other at this moment. Who closed the gap, over this moment and a little before it?
    const since = now - pa.t;
    // How far apart along the track they were then (centre to centre).
    let gap = Math.abs(pa.s - pb.s);
    if (gap > track.length / 2) gap = track.length - gap;
    const ref = (trail: TrailPoint[]) => trail.find((p) => p.t >= pa.t - MOVE_WINDOW) ?? trail[0];
    const ra = ref(ta);
    const rb = ref(tb);
    const towardsB = Math.sign(rb.d - ra.d);
    const moveA = (da.d - ra.d) * towardsB;
    const moveB = (db.d - rb.d) * -towardsB;
    if (moveA >= MOVE_MIN && moveA > 2 * Math.max(0, moveB)) return { mover: a, other: b, since, gap };
    if (moveB >= MOVE_MIN && moveB > 2 * Math.max(0, moveA)) return { mover: b, other: a, since, gap };
    return null;
  }
  return null;
}

/** Signed distance (m) along the lap from b forward to a, allowing for the start-line wrap. */
function along(track: Track, a: Racer, b: Racer): number {
  const pa = track.query(a.car.x, a.car.y, a.car.trackIndex);
  const pb = track.query(b.car.x, b.car.y, b.car.trackIndex);
  if (!pa || !pb) return 0;
  let ds = track.forwardDistance(pb.s, pa.s);
  if (ds > track.length / 2) ds -= track.length;
  return ds;
}

/**
 * Decide who caused a contact. Only clear cases get a penalty; anything ambiguous is a
 * racing incident. The driver who was hit is never penalised:
 * - driving the wrong way (moving backwards): always at fault;
 * - the car behind running into the car in front: the car behind, even if the car in front
 *   was braking or changing line, unless the car in front cut right across its nose (less
 *   than a car length ahead, too late to react, on a straight);
 * - moving sideways into a car that is alongside: the car that moved (in a corner the other
 *   car must be properly alongside to be owed room, since turning in is just the line);
 * - arriving far faster into a car turning in that it wasn't alongside: a dive-bomb;
 * - nose into a side, clearly the faster one into the contact: the hitter.
 */
export function judge(
  track: Track,
  a: Racer,
  b: Racer,
  nx: number,
  ny: number,
  px: number,
  py: number,
  now: number,
): Verdict {
  const partA = partHit(a.car, px, py);
  const partB = partHit(b.car, px, py);
  // How fast each car was moving into the other.
  const closingA = a.car.vx * nx + a.car.vy * ny;
  const closingB = -(b.car.vx * nx + b.car.vy * ny);

  const none: Verdict = { atFault: null, reason: '' };
  const wrongA = wrongWay(track, a.car);
  const wrongB = wrongWay(track, b.car);
  if (wrongA !== wrongB) return { atFault: wrongA ? a : b, reason: 'driving the wrong way' };
  if (wrongA) return none;

  // Who is in front along the track, and did the car behind run into it? Nose first into its
  // gearbox, or into its side while still clearly behind it, and doing the closing.
  const ds = along(track, a, b);
  const [front, rear] = ds >= 0 ? [a, b] : [b, a];
  const rearPart = rear === a ? partA : partB;
  const frontPart = front === a ? partA : partB;
  const rearClosing = rear === a ? closingA : closingB;
  const frontClosing = front === a ? closingA : closingB;
  const inLine = Math.abs(ds) > IN_LINE_GAP;
  const ranIntoBack =
    rearPart === 'front' && frontPart !== 'front' && rearClosing > frontClosing && (frontPart === 'rear' || inLine);

  // On a straight, moving across is a choice; in a corner it is just the line into it.
  const straight = Math.abs(track.query(px, py)?.sample.curvature ?? 1) < STRAIGHT_CURVATURE;
  const move = lateralMove(track, a, b, now);
  if (move) {
    const { mover, other } = move;
    if (ranIntoBack) {
      // Cut right across the nose of a car close behind: it had no time to avoid it.
      const cutOff = mover === front && straight && move.since < REACTION_TIME && move.gap < CUT_OFF_GAP;
      return cutOff ? { atFault: front, reason: 'moved across in front' } : { atFault: rear, reason: 'hit from behind' };
    }
    // Side contact: was the other car alongside, so the mover had to leave it room? On a
    // straight its front wheels level with our middle are enough; in a corner they must be
    // further up, about level with our cockpit.
    const otherAhead = along(track, other, mover);
    const needed = straight ? -0.5 : 1;
    if (otherAhead + other.car.params.cgToFront > needed) return { atFault: mover, reason: 'moved into a car alongside' };
    // Not alongside: the mover was entitled to the line, unless the other came flying in
    // from behind far too fast to stop (a dive-bomb).
    const faster = other.car.speed - mover.car.speed;
    return faster > DIVE_BOMB_SPEED && otherAhead < 0 ? { atFault: other, reason: 'dive-bomb' } : none;
  }

  // Into the back of the car in front: the car behind.
  if (ranIntoBack) return { atFault: rear, reason: 'hit from behind' };

  // Nose into someone's side, clearly the faster one into the contact: a dive-bomb or T-bone.
  if (partA === 'front' && partB === 'side' && closingA > closingB + 2) return { atFault: a, reason: 'dive-bomb' };
  if (partB === 'front' && partA === 'side' && closingB > closingA + 2) return { atFault: b, reason: 'dive-bomb' };

  // Side by side, nose to nose, or unclear: racing incident.
  return none;
}

/**
 * Push overlapping cars apart with a proper impulse (including spin), apply damage, and
 * judge any significant hit. `cooldowns` remembers when each pair was last judged.
 */
export function resolveCollisions(track: Track, racers: Racer[], time: number, cooldowns: Map<string, number>): Contact[] {
  const contacts: Contact[] = [];
  const active = racers.filter((r) => !r.frozen);
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i];
      const b = active[j];
      const ca = a.car;
      const cb = b.car;
      if (Math.abs(ca.x - cb.x) > 7 || Math.abs(ca.y - cb.y) > 7) continue;
      // Different parts of the lap that pass close by (Suzuka's bridge goes over the other
      // road): those cars can't touch.
      if (onOtherStretches(track, ca, cb)) continue;
      const hit = overlap(box(ca), box(cb));
      if (!hit) continue;
      const { nx, ny, depth, px, py } = hit;

      // Separate (equal masses: half each).
      ca.x -= nx * depth * 0.5;
      ca.y -= ny * depth * 0.5;
      cb.x += nx * depth * 0.5;
      cb.y += ny * depth * 0.5;

      const rax = px - ca.x;
      const ray = py - ca.y;
      const rbx = px - cb.x;
      const rby = py - cb.y;
      const vax = ca.vx - ca.yawRate * ray;
      const vay = ca.vy + ca.yawRate * rax;
      const vbx = cb.vx - cb.yawRate * rby;
      const vby = cb.vy + cb.yawRate * rbx;
      const vn = (vbx - vax) * nx + (vby - vay) * ny;
      if (vn >= 0) continue;

      const invM = 1 / ca.params.mass + 1 / cb.params.mass;
      const raN = rax * ny - ray * nx;
      const rbN = rbx * ny - rby * nx;
      const k = invM + (raN * raN) / ca.params.inertia + (rbN * rbN) / cb.params.inertia;
      const jn = (-(1 + RESTITUTION) * vn) / k;

      // Judge before the impulse changes the velocities.
      const impact = -vn;
      const key = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
      const judged = impact >= PENALTY_MIN_IMPACT && time - (cooldowns.get(key) ?? -Infinity) > PAIR_COOLDOWN;
      const verdict = judged ? judge(track, a, b, nx, ny, px, py, time) : null;
      const atFault = verdict?.atFault ?? null;

      applyImpulse(ca, -jn * nx, -jn * ny, rax, ray);
      applyImpulse(cb, jn * nx, jn * ny, rbx, rby);

      // Scraping friction along the contact.
      const tx = -ny;
      const ty = nx;
      const vt = (vbx - vax) * tx + (vby - vay) * ty;
      const raT = rax * ty - ray * tx;
      const rbT = rbx * ty - rby * tx;
      const kt = invM + (raT * raT) / ca.params.inertia + (rbT * rbT) / cb.params.inertia;
      const jt = Math.max(-FRICTION * jn, Math.min(FRICTION * jn, -vt / kt));
      applyImpulse(ca, -jt * tx, -jt * ty, rax, ray);
      applyImpulse(cb, jt * tx, jt * ty, rbx, rby);

      // Cars crumple into each other more gently than into a wall.
      ca.impact(impact * CAR_IMPACT_SCALE, ...toLocal(ca, px, py));
      cb.impact(impact * CAR_IMPACT_SCALE, ...toLocal(cb, px, py));

      if (judged) {
        cooldowns.set(key, time);
        const victim = atFault === a ? b : a;
        const serious = impact >= BIG_HIT || victim.car.retired;
        const penalty = atFault ? (victim.car.retired ? 10 : 5) : 0;
        contacts.push({ a, b, impact, atFault, reason: verdict!.reason, penalty, serious });
      }
    }
  }
  return contacts;
}

/** Cars this many track samples apart are on different stretches of track. */
const OTHER_STRETCH_SAMPLES = 25;

/** On different parts of the lap that pass close by (e.g. over and under Suzuka's bridge). */
export function onOtherStretches(track: Track, a: Car, b: Car): boolean {
  if (a.trackIndex === null || b.trackIndex === null) return false;
  const n = track.samples.length;
  const di = Math.abs(a.trackIndex - b.trackIndex);
  return Math.min(di, n - di) > OTHER_STRETCH_SAMPLES;
}

/** A world point in a car's own frame (x forward, y right). */
function toLocal(c: Car, px: number, py: number): [number, number] {
  const dx = px - c.x;
  const dy = py - c.y;
  const cos = Math.cos(c.heading);
  const sin = Math.sin(c.heading);
  return [dx * cos + dy * sin, -dx * sin + dy * cos];
}

function applyImpulse(c: Car, jx: number, jy: number, rx: number, ry: number): void {
  c.vx += jx / c.params.mass;
  c.vy += jy / c.params.mass;
  c.yawRate += (rx * jy - ry * jx) / c.params.inertia;
}
