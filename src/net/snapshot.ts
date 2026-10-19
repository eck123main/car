import { GRID_MAX_TIME, type Session } from '../sim/session';
import { Tyres, type Compound } from '../sim/tyres';
import type { PlayerInput, Racer } from '../sim/world';
import type { CarSnap, PackedInput, SessionSnap, TimingSnap } from './protocol';

/**
 * Round for sending. Full-precision numbers are ~18 characters of JSON each; millimetres and
 * thousandths are plenty, and cut a snapshot to about half (it goes to every player 20 times a second).
 */
function round(v: number, decimals = 3): number {
  const k = 10 ** decimals;
  return Math.round(v * k) / k;
}

export function carSnap(r: Racer, ack: number): CarSnap {
  const c = r.car;
  return {
    id: r.id,
    x: round(c.x),
    y: round(c.y),
    h: round(c.heading, 5),
    vx: round(c.vx),
    vy: round(c.vy),
    w: round(c.yawRate, 4),
    steer: round(c.steer),
    thr: round(c.throttle),
    brk: round(c.brake),
    parts: [round(c.parts.frontWing), round(c.parts.rearWing), round(c.parts.left), round(c.parts.right)],
    ret: c.retired,
    frozen: r.frozen,
    grip: round(c.gripFactor, 4),
    drag: round(c.dragFactor, 4),
    power: Math.round(c.extraPower),
    limit: c.speedLimit === null ? null : round(c.speedLimit),
    reverse: c.allowReverse,
    tyre: r.tyres.compound,
    wear: round(r.tyres.wear, 4),
    ers: round(r.ers, 4),
    ersOn: r.ersActive,
    drs: r.drsOpen,
    drsOk: r.drsEligible,
    drsHint: r.drsHint,
    tow: round(r.slipstream),
    pit: r.pit.phase,
    pitEnds: round(r.pit.stopEnds),
    limiter: r.input.limiter,
    next: r.input.nextTyre,
    ack,
  };
}

const TYRE_ORDER: Compound[] = ['soft', 'medium', 'hard', 'inter', 'wet'];
const FLAGS = ['drs', 'ers', 'limiter', 'reset', 'ready'] as const;

/** An input in a few bytes, for the 120-a-second stream from each player to the host. */
export function packInput(seq: number, input: PlayerInput): PackedInput {
  let flags = 0;
  FLAGS.forEach((f, i) => {
    if (input[f]) flags |= 1 << i;
  });
  return [seq, round(input.throttle), round(input.brake), round(input.steer), flags, TYRE_ORDER.indexOf(input.nextTyre)];
}

/** The other way round. Null if it isn't a valid input (it comes from another player's browser). */
export function unpackInput(p: unknown): { seq: number; input: PlayerInput } | null {
  if (!Array.isArray(p) || p.length !== 6 || !p.every((v) => typeof v === 'number' && Number.isFinite(v))) return null;
  const [seq, throttle, brake, steer, flags, tyre] = p as PackedInput;
  const clamp = (v: number, lo: number) => Math.max(lo, Math.min(1, v));
  const flag = (f: (typeof FLAGS)[number]) => (flags & (1 << FLAGS.indexOf(f))) !== 0;
  return {
    seq,
    input: {
      throttle: clamp(throttle, 0),
      brake: clamp(brake, 0),
      steer: clamp(steer, -1),
      drs: flag('drs'),
      ers: flag('ers'),
      limiter: flag('limiter'),
      reset: flag('reset'),
      ready: flag('ready'),
      nextTyre: TYRE_ORDER[tyre] ?? 'medium',
    },
  };
}

/** Copy the car's physics state (used for both display and prediction resets). */
export function applyCarPhysics(r: Racer, s: CarSnap): void {
  const c = r.car;
  c.x = s.x;
  c.y = s.y;
  c.heading = s.h;
  c.vx = s.vx;
  c.vy = s.vy;
  c.yawRate = s.w;
  c.steer = s.steer;
  c.throttle = s.thr;
  c.brake = s.brk;
  c.parts = { frontWing: s.parts[0], rearWing: s.parts[1], left: s.parts[2], right: s.parts[3] };
  c.retired = s.ret;
  c.gripFactor = s.grip;
  c.dragFactor = s.drag;
  c.extraPower = s.power;
  c.speedLimit = s.limit;
  c.allowReverse = s.reverse;
}

/** Copy everything else the HUD shows. */
export function applyCarStatus(r: Racer, s: CarSnap): void {
  r.frozen = s.frozen;
  if (r.tyres.compound !== s.tyre) r.tyres = new Tyres(s.tyre);
  r.tyres.wear = s.wear;
  r.ers = s.ers;
  r.ersActive = s.ersOn;
  r.drsOpen = s.drs;
  r.drsEligible = s.drsOk;
  r.drsHint = s.drsHint;
  r.slipstream = s.tow;
  r.pit.phase = s.pit;
  r.pit.stopEnds = s.pitEnds;
  r.input = { ...r.input, limiter: s.limiter, nextTyre: s.next };
}

export function timingSnap(session: Session, r: Racer): TimingSnap {
  return {
    ...r.timer.snapshot(),
    id: r.id,
    delta: r.timer.delta(session.world.time),
    penalties: r.penalties,
    compoundsUsed: r.compoundsUsed,
    stops: r.pit.stops,
  };
}

export function applyTiming(r: Racer, t: TimingSnap): void {
  r.timer.restore(t);
  r.penalties = t.penalties;
  r.compoundsUsed = t.compoundsUsed;
  r.pit.stops = t.stops;
}

export function sessionSnap(session: Session): SessionSnap {
  return {
    phase: session.phase,
    lights: session.lights,
    raceStart: session.raceStart,
    laps: session.settings.laps,
    mandatoryStop: session.mandatoryStop,
    tyreWear: session.tyreWear,
    noContact: session.settings.noContact,
    wetness: session.world.options.wetness,
    standings: session.standings(),
    quali: [...session.quali.entries()],
    recovering: [...session.recovering.entries()],
    ready: [...session.ready],
    gridEndsAt: session.phase === 'grid' ? session.phaseStart + GRID_MAX_TIME : 0,
    safetyCar: session.safetyCar?.phase ?? null,
    noOvertaking: [...session.noOvertaking],
  };
}
