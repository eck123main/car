import { boxLane } from '../sim/pit';
import type { Compound } from '../sim/tyres';
import type { RaceWorld, Racer } from '../sim/world';

/**
 * Pit stops brought to life: each team's crew walks out of the garage as its car comes down the
 * lane, jacks it up, swaps the tyres (old ones carried off, new ones in the chosen compound's
 * colour), shows a red then green light, and the car leaves with a puff of tyre smoke and two
 * rubber marks. Looks only: worked out from each car's pit phase (so it plays the same on the
 * host and on every client), as a `PitScene` that both the top-down and the 3D view draw.
 */

export interface Pose {
  x: number;
  y: number;
  heading: number;
}

export interface CrewMember extends Pose {
  color: string;
  /** A tyre held out in front. */
  tyre: Compound | null;
  /** Walking (bobs up and down in 3D). */
  walking: boolean;
}

export interface PitBox extends Pose {
  color: string;
  /** Three letters of the driver's name. */
  name: string;
  /** Which way the garage is across the box: +1 the box's left (local +y), -1 its right. */
  garage: number;
}

export interface PitScene {
  boxes: PitBox[];
  crew: CrewMember[];
  /** Wheel guns spinning (a flicker at the wheel nut). */
  sparks: { x: number; y: number }[];
  /** Jack bars under the nose and gearbox of a car that's up. */
  jacks: Pose[];
  /** Each box's light on a post at its front. */
  lights: { x: number; y: number; state: 'off' | 'red' | 'green' }[];
  /** Release smoke: puffs growing and fading. */
  smoke: { x: number; y: number; radius: number; alpha: number }[];
  /** Rubber laid on release, fading. */
  rubber: { x0: number; y0: number; x1: number; y1: number; alpha: number }[];
  /** How far each stopped car is up on its jacks (0..1), by racer id. */
  lift: Map<string, number>;
  /** New tyres already on a car still in its box, by racer id. */
  fitted: Map<string, Compound>;
}

/** What one car's crew is doing, followed frame to frame. */
interface CrewState {
  phase: Racer['pit']['phase'];
  /** World time the phase began (as seen here). */
  since: number;
  /** For the stop: when it ends. */
  stopEnds: number;
  /** Tyres coming off, and going on. */
  oldTyre: Compound;
  newTyre: Compound;
  /** Where and when the car was released (for the walk back, smoke and rubber). */
  release: (Pose & { time: number }) | null;
}

/** Crew walk-out time as the car comes in, and walk-back after it leaves (s). */
const WALK = 1.2;
/** How long the release smoke and rubber marks last (s). */
const SMOKE_TIME = 1.1;
const RUBBER_TIME = 5;
/** Where the crew stand before walking out: this far out on the garage side (m). */
const GARAGE = 6.5;

export const WHEEL_X = { front: 1.95, rear: -1.65 };
export const WHEEL_Y = 0.75;

type Role = 'gun' | 'carry' | 'jack' | 'hold';
/** Crew spots round the car: along (+ = nose), across (+ = garage side). */
const CREW: { a: number; o: number; role: Role; wheel: number }[] = [];
(['front', 'rear'] as const).forEach((end, e) =>
  [-1, 1].forEach((side, s) => {
    const wheel = e * 2 + s;
    CREW.push({ a: WHEEL_X[end], o: side * 1.55, role: 'gun', wheel });
    CREW.push({ a: WHEEL_X[end] + (end === 'front' ? 0.75 : -0.75), o: side * 1.6, role: 'carry', wheel });
  }),
);
CREW.push({ a: 3.6, o: 0, role: 'jack', wheel: 0 }, { a: -3.2, o: 0, role: 'jack', wheel: 0 }, { a: 0.3, o: 1.6, role: 'hold', wheel: 0 }, { a: 0.3, o: -1.6, role: 'hold', wheel: 0 });

/** Most crew a scene can hold (10 cars). */
export const MAX_CREW = CREW.length * 10;

export class PitStops {
  private readonly crews = new Map<string, CrewState>();

  /** Follow each car's pit phase. Call once a frame. */
  update(world: RaceWorld): void {
    const t = world.time;
    for (const r of world.racers) {
      let c = this.crews.get(r.id);
      const phase = r.pit.phase;
      // A new session (its clock starts again): start afresh.
      if (!c || t < c.since) {
        c = { phase, since: t, stopEnds: r.pit.stopEnds, oldTyre: r.tyres.compound, newTyre: r.input.nextTyre, release: null };
        this.crews.set(r.id, c);
        continue;
      }
      if (c.phase !== phase) {
        if (phase === 'leaving' && c.phase === 'stopped') c.release = { x: r.car.x, y: r.car.y, heading: r.car.heading, time: t };
        if (phase === 'stopped') c.oldTyre = r.tyres.compound;
        c.phase = phase;
        c.since = t;
      }
      if (phase === 'stopped') {
        c.stopEnds = r.pit.stopEnds;
        c.newTyre = r.input.nextTyre;
      }
    }
  }

  /** Everything to draw this frame. `poses`: where each car is drawn. */
  scene(world: RaceWorld, poses: ReadonlyMap<string, Pose>): PitScene {
    const out: PitScene = { boxes: [], crew: [], sparks: [], jacks: [], lights: [], smoke: [], rubber: [], lift: new Map(), fitted: new Map() };
    const lane = world.track.pit;
    if (!lane) return out;
    const ss = world.track.samples;
    const now = world.time;
    for (const r of world.racers) {
      const c = this.crews.get(r.id);
      const p = poses.get(r.id);
      const bt = ss[Math.floor(lane.boxes[r.pit.box % lane.boxes.length] / 2) % ss.length];
      const off = boxLane(world.track, bt.halfWidth);
      const box: Pose = { x: bt.x + bt.nx * off, y: bt.y + bt.ny * off, heading: Math.atan2(bt.ty, bt.tx) };
      const garage = Math.sign(lane.side * (bt.nx * -bt.ty + bt.ny * bt.tx)) || 1;
      out.boxes.push({ ...box, color: r.color, name: r.name.slice(0, 3).toUpperCase(), garage });
      if (!c || !p) {
        out.lights.push({ ...lightSpot(box, garage), state: 'off' });
        continue;
      }
      const t = now - c.since;
      const stopped = c.phase === 'stopped';
      const released = c.release && !stopped ? now - c.release.time : Infinity;
      // 0: in the garage, 1: in position round the car.
      const walk = c.phase === 'in' ? Math.min(1, t / WALK) : stopped ? 1 : Math.max(0, 1 - released / WALK);
      const go = (stopped && c.stopEnds - now < 0.35) || (c.phase === 'leaving' && walk > 0);
      out.lights.push({ ...lightSpot(box, garage), state: go ? 'green' : stopped ? 'red' : 'off' });

      if (stopped) {
        const lift = Math.min(1, t / 0.25) * Math.min(1, Math.max(0, (c.stopEnds - now) / 0.25));
        out.lift.set(r.id, lift);
      }
      if (walk > 0) this.crewFor(out, r, c, stopped ? p : box, garage, walk, now);

      if (c.release && released < RUBBER_TIME) {
        // Two short black stripes where the rear tyres spun up.
        const { x, y, heading: h } = c.release;
        const fx = Math.cos(h);
        const fy = Math.sin(h);
        for (const side of [-1, 1]) {
          const bx = x - fx * 1.65 - fy * side * 0.75;
          const by = y - fy * 1.65 + fx * side * 0.75;
          out.rubber.push({ x0: bx, y0: by, x1: bx + fx * 3.2, y1: by + fy * 3.2, alpha: 1 - released / RUBBER_TIME });
        }
      }
      if (c.release && released < SMOKE_TIME) {
        // Grey-white smoke rolling off the rear wheels.
        const k = released / SMOKE_TIME;
        const { x, y, heading: h } = c.release;
        const fx = Math.cos(h);
        const fy = Math.sin(h);
        for (let i = 0; i < 6; i++) {
          const side = i % 2 ? 1 : -1;
          const row = i >> 1;
          const back = 2 + row * 0.9 + k * 2.5;
          const spread = 0.8 + k * 1.4 + row * 0.2;
          out.smoke.push({ x: x - fx * back - fy * side * spread, y: y - fy * back + fx * side * spread, radius: 0.5 + k * 1.3 + row * 0.15, alpha: 1 - k });
        }
      }
    }
    return out;
  }

  private crewFor(out: PitScene, r: Racer, c: CrewState, at: Pose, garage: number, walk: number, now: number): void {
    const stopped = c.phase === 'stopped';
    const t = now - c.since;
    const dur = Math.max(1, c.stopEnds - c.since);
    // The tyre swap: off in the first half, new ones on in the second.
    const swap = stopped ? Math.min(1, Math.max(0, (t - 0.35) / Math.max(0.5, dur - 1.1))) : c.phase === 'in' ? 0 : 1;
    const cos = Math.cos(at.heading);
    const sin = Math.sin(at.heading);
    const place = (a: number, o: number): [number, number] => {
      const y = o * garage;
      return [at.x + cos * a - sin * y, at.y + sin * a + cos * y];
    };
    const ease = walk * walk * (3 - 2 * walk);
    for (const m of CREW) {
      // From the garage (well out on the garage side) to the spot round the car.
      let o = m.o + (1 - ease) * (GARAGE - m.o);
      // Carriers wait holding the new tyres, then take the old ones off, stepping back with them.
      const tyre = m.role !== 'carry' ? null : c.phase === 'in' ? c.newTyre : stopped && swap > 0 && swap < 0.5 ? c.oldTyre : null;
      if (stopped && m.role === 'carry') o += Math.sign(m.o) * Math.sin(Math.min(1, swap * 2) * Math.PI) * 0.9;
      const [x, y] = place(m.a, o);
      // Facing the car: jack men along it, everyone else across it.
      const facing = at.heading + (m.o === 0 ? (m.a > 0 ? Math.PI : 0) : (m.o > 0 ? -Math.PI / 2 : Math.PI / 2) * garage);
      out.crew.push({ x, y, heading: facing, color: r.color, tyre, walking: walk < 1 });
      if (m.role === 'gun' && stopped && ((t > 0.3 && t < 0.8) || (swap > 0.6 && swap < 0.95)) && Math.floor(now * 30 + m.wheel) % 2) {
        const [wx, wy] = place(m.a, Math.sign(m.o) * WHEEL_Y);
        out.sparks.push({ x: wx, y: wy });
      }
    }
    if (stopped) {
      if (swap >= 0.5) out.fitted.set(r.id, c.newTyre);
      for (const a of [3.2, -2.85]) {
        const [x, y] = place(a, 0);
        out.jacks.push({ x, y, heading: at.heading });
      }
    }
  }
}

/** The box light stands on a post at the front corner of the box, on the fast-lane side. */
function lightSpot(box: Pose, garage: number): { x: number; y: number } {
  const a = 4.6;
  const o = -1.9 * garage;
  return { x: box.x + Math.cos(box.heading) * a - Math.sin(box.heading) * o, y: box.y + Math.sin(box.heading) * a + Math.cos(box.heading) * o };
}
