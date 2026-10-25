import { boxLane } from '../sim/pit';
import { COMPOUNDS, type Compound } from '../sim/tyres';
import type { RaceWorld, Racer } from '../sim/world';

/**
 * Pit stops brought to life, drawn in world metres: each team's crew walks out of the garage
 * as its car comes down the lane, jacks it up, swaps the tyres (old ones carried off, new ones
 * in the chosen compound's colour), shows a red then green light, and the car leaves with a
 * puff of tyre smoke and two rubber marks. Looks only: worked out from each car's pit phase,
 * so it plays the same on the host and on every client.
 */

interface Pose {
  x: number;
  y: number;
  heading: number;
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

/** Crew walk-out time before the car arrives, and walk-back after it leaves (s). */
const WALK = 1.2;
/** How long the release smoke and rubber marks last (s). */
const SMOKE_TIME = 1.1;
const RUBBER_TIME = 5;

const HELMET = '#f2f2f2';
const TYRE = '#141414';

/** Crew positions round the car: [along (+ = nose), across (+ = garage side), role]. */
const WHEEL_X = { front: 1.95, rear: -1.65 };
const WHEEL_Y = 0.75;
type Role = 'gun' | 'carry' | 'jack' | 'hold';
const CREW: { a: number; o: number; role: Role; wheel?: number }[] = [];
(['front', 'rear'] as const).forEach((end, e) =>
  [-1, 1].forEach((side, s) => {
    const wheel = e * 2 + s;
    CREW.push({ a: WHEEL_X[end], o: side * 1.55, role: 'gun', wheel });
    CREW.push({ a: WHEEL_X[end] + (end === 'front' ? 0.75 : -0.75), o: side * 1.6, role: 'carry', wheel });
  }),
);
CREW.push({ a: 3.6, o: 0, role: 'jack' }, { a: -3.2, o: 0, role: 'jack' }, { a: 0.3, o: 1.6, role: 'hold' }, { a: 0.3, o: -1.6, role: 'hold' });

export class PitCrews {
  private readonly crews = new Map<string, CrewState>();

  /** Follow each car's pit phase. Call once a frame, before drawing. */
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

  /** Under the cars: the car's shadow on its jacks, rubber laid on release. */
  drawUnder(ctx: CanvasRenderingContext2D, world: RaceWorld, poses: ReadonlyMap<string, Pose>): void {
    for (const r of world.racers) {
      const c = this.crews.get(r.id);
      const p = poses.get(r.id);
      if (!c || !p) continue;
      const t = world.time - c.since;
      if (c.phase === 'stopped') {
        // Lifted: a wider, softer shadow.
        const lift = Math.min(1, t / 0.25) * Math.min(1, Math.max(0, (c.stopEnds - world.time) / 0.25));
        if (lift > 0) {
          ctx.save();
          ctx.translate(p.x + 0.35 * lift, p.y + 0.35 * lift);
          ctx.rotate(p.heading);
          ctx.fillStyle = `rgba(0,0,0,${0.35 * lift})`;
          roundRect(ctx, -2.9, -1.05, 5.8, 2.1, 0.8);
          ctx.fill();
          ctx.restore();
        }
      }
      const since = c.release ? world.time - c.release.time : Infinity;
      if (c.release && c.phase !== 'stopped' && since < RUBBER_TIME) {
        // Two short black stripes where the rear tyres spun up.
        const fade = 1 - since / RUBBER_TIME;
        const { x, y, heading: h } = c.release;
        const fx = Math.cos(h);
        const fy = Math.sin(h);
        ctx.strokeStyle = `rgba(10,10,10,${0.55 * fade})`;
        ctx.lineWidth = 0.38;
        ctx.lineCap = 'round';
        ctx.beginPath();
        for (const side of [-1, 1]) {
          const bx = x - fx * 1.65 - fy * side * 0.75;
          const by = y - fy * 1.65 + fx * side * 0.75;
          ctx.moveTo(bx, by);
          ctx.lineTo(bx + fx * 3.2, by + fy * 3.2);
        }
        ctx.stroke();
        ctx.lineCap = 'butt';
      }
    }
  }

  /** Over the cars: the crews, tyres, wheel guns, lights and release smoke. */
  drawOver(ctx: CanvasRenderingContext2D, world: RaceWorld, poses: ReadonlyMap<string, Pose>): void {
    const lane = world.track.pit;
    if (!lane) return;
    const ss = world.track.samples;
    for (const r of world.racers) {
      const c = this.crews.get(r.id);
      const p = poses.get(r.id);
      if (!c || !p) continue;
      const now = world.time;
      const t = now - c.since;
      const boxS = lane.boxes[r.pit.box % lane.boxes.length];
      const bt = ss[Math.floor(boxS / 2) % ss.length];
      const off = boxLane(world.track, bt.halfWidth);
      const box: Pose = { x: bt.x + bt.nx * off, y: bt.y + bt.ny * off, heading: Math.atan2(bt.ty, bt.tx) };
      // Which way the garage is, across the box (+1: the box's left, -1: its right).
      const garage = Math.sign(-Math.sin(box.heading) * bt.nx * lane.side + Math.cos(box.heading) * bt.ny * lane.side) || 1;

      let out = 0; // 0: in the garage, 1: in position
      let anchor = box;
      const released = c.release && c.phase !== 'stopped' ? now - c.release.time : Infinity;
      if (c.phase === 'in') {
        // Walk out as the car turns into the lane.
        out = Math.min(1, t / WALK);
      } else if (c.phase === 'stopped') {
        out = 1;
        anchor = p;
      } else {
        out = Math.max(0, 1 - released / WALK);
      }

      if (out > 0) this.drawCrew(ctx, r, c, anchor, garage, out, now);
      if (out > 0 || c.phase === 'stopped') this.drawLight(ctx, box, garage, c, now);
      if (c.release && released < SMOKE_TIME) drawSmoke(ctx, c.release, released);
    }
  }

  private drawCrew(ctx: CanvasRenderingContext2D, r: Racer, c: CrewState, at: Pose, garage: number, out: number, now: number): void {
    const stopped = c.phase === 'stopped';
    const t = now - c.since;
    const dur = Math.max(1, c.stopEnds - c.since);
    // The tyre swap: off in the first half, new ones on in the second.
    const swap = stopped ? Math.min(1, Math.max(0, (t - 0.35) / Math.max(0.5, dur - 1.1))) : c.phase === 'in' ? 0 : 1;
    const cos = Math.cos(at.heading);
    const sin = Math.sin(at.heading);
    const world = (a: number, o: number): [number, number] => {
      const y = o * garage;
      return [at.x + cos * a - sin * y, at.y + sin * a + cos * y];
    };
    const ease = out * out * (3 - 2 * out);
    for (const m of CREW) {
      // From the garage (well out on the garage side) to the spot round the car.
      const o = m.o + (1 - ease) * (6.5 - m.o);
      const a = m.a;
      // Carriers wait holding the new tyres, then take the old ones off (stepping back with them).
      const carry = m.role !== 'carry' ? null : c.phase === 'in' ? c.newTyre : stopped && swap > 0 && swap < 0.5 ? c.oldTyre : null;
      const [x, y] = world(a, stopped && m.role === 'carry' ? o + Math.sign(m.o) * Math.sin(Math.min(1, swap * 2) * Math.PI) * 0.9 : o);
      drawPerson(ctx, x, y, at.heading + (m.o === 0 ? (m.a > 0 ? Math.PI : 0) : (m.o > 0 ? -Math.PI / 2 : Math.PI / 2) * garage), r.color, carry);
      if (m.role === 'gun' && stopped && ((t > 0.3 && t < 0.8) || (swap > 0.6 && swap < 0.95))) {
        // Wheel gun spinning: a bright flicker at the wheel nut.
        const [wx, wy] = world(a, Math.sign(m.o) * WHEEL_Y);
        ctx.fillStyle = Math.floor(now * 30 + (m.wheel ?? 0)) % 2 ? '#ffe680' : '#ffffff';
        ctx.beginPath();
        ctx.arc(wx, wy, 0.24, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (stopped && swap >= 0.5) {
      // New tyres on: their sidewalls show the new compound before the car even leaves.
      const col = COMPOUNDS[c.newTyre].color;
      for (const [wa, side] of [[WHEEL_X.front, -1], [WHEEL_X.front, 1], [WHEEL_X.rear, -1], [WHEEL_X.rear, 1]] as const) {
        const [wx, wy] = world(wa, side * WHEEL_Y);
        ctx.save();
        ctx.translate(wx, wy);
        ctx.rotate(at.heading);
        ctx.fillStyle = TYRE;
        ctx.fillRect(-0.36, -0.2, 0.72, 0.4);
        ctx.fillStyle = col;
        ctx.fillRect(-0.3, -0.2, 0.6, 0.09);
        ctx.fillRect(-0.3, 0.11, 0.6, 0.09);
        ctx.restore();
      }
    }
    // Jacks: a bar under the nose and the gearbox while the car is up.
    if (stopped) {
      ctx.strokeStyle = '#c9c9c9';
      ctx.lineWidth = 0.18;
      ctx.beginPath();
      for (const [a0, a1] of [[2.9, 3.5], [-2.55, -3.1]]) {
        const [x0, y0] = world(a0, 0);
        const [x1, y1] = world(a1, 0);
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
      }
      ctx.stroke();
    }
  }

  /** The box's light on a post at the front: red while the crew works, green to go. */
  private drawLight(ctx: CanvasRenderingContext2D, box: Pose, garage: number, c: CrewState, now: number): void {
    const go = (c.phase === 'stopped' && c.stopEnds - now < 0.35) || c.phase === 'leaving';
    const a = 4.6;
    const o = -1.9 * garage;
    const x = box.x + Math.cos(box.heading) * a - Math.sin(box.heading) * o;
    const y = box.y + Math.sin(box.heading) * a + Math.cos(box.heading) * o;
    ctx.fillStyle = '#111';
    ctx.fillRect(x - 0.45, y - 0.45, 0.9, 0.9);
    ctx.fillStyle = go ? '#2ecc40' : c.phase === 'stopped' ? '#ff2a1f' : '#553333';
    ctx.beginPath();
    ctx.arc(x, y, 0.3, 0, Math.PI * 2);
    ctx.fill();
    if (go || c.phase === 'stopped') {
      ctx.fillStyle = go ? 'rgba(46,204,64,0.25)' : 'rgba(255,42,31,0.25)';
      ctx.beginPath();
      ctx.arc(x, y, 0.8, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/** A crew member from above: shoulders in the team colour, a white helmet, maybe a tyre. */
function drawPerson(ctx: CanvasRenderingContext2D, x: number, y: number, facing: number, color: string, tyre: Compound | null): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(facing);
  // Drawn a little larger than life, so they read at race zoom.
  ctx.scale(1.4, 1.4);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(0, 0, 0.22, 0.34, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.75)';
  ctx.lineWidth = 0.07;
  ctx.stroke();
  ctx.fillStyle = HELMET;
  ctx.beginPath();
  ctx.arc(0.02, 0, 0.15, 0, Math.PI * 2);
  ctx.fill();
  if (tyre) {
    // Held out in front.
    ctx.fillStyle = TYRE;
    ctx.beginPath();
    ctx.arc(0.5, 0, 0.32, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = COMPOUNDS[tyre].color;
    ctx.lineWidth = 0.08;
    ctx.beginPath();
    ctx.arc(0.5, 0, 0.22, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

/** Grey-white tyre smoke rolling off the rear wheels as the car is released. */
function drawSmoke(ctx: CanvasRenderingContext2D, at: Pose, t: number): void {
  const k = t / SMOKE_TIME;
  const fx = Math.cos(at.heading);
  const fy = Math.sin(at.heading);
  for (let i = 0; i < 6; i++) {
    const side = i % 2 ? 1 : -1;
    const back = 2 + (i >> 1) * 0.9 + k * 2.5;
    const spread = 0.8 + k * 1.4 + (i >> 1) * 0.2;
    const x = at.x - fx * back - fy * side * spread;
    const y = at.y - fy * back + fx * side * spread;
    ctx.fillStyle = `rgba(225,225,225,${0.45 * (1 - k)})`;
    ctx.beginPath();
    ctx.arc(x, y, 0.5 + k * 1.3 + (i >> 1) * 0.15, 0, Math.PI * 2);
    ctx.fill();
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
