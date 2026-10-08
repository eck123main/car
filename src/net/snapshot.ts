import type { Session } from '../sim/session';
import { Tyres } from '../sim/tyres';
import type { Racer } from '../sim/world';
import type { CarSnap, SessionSnap, TimingSnap } from './protocol';

export function carSnap(r: Racer, ack: number): CarSnap {
  const c = r.car;
  return {
    id: r.id,
    x: c.x,
    y: c.y,
    h: c.heading,
    vx: c.vx,
    vy: c.vy,
    w: c.yawRate,
    steer: c.steer,
    thr: c.throttle,
    brk: c.brake,
    dmg: c.damage,
    ret: c.retired,
    frozen: r.frozen,
    grip: c.gripFactor,
    drag: c.dragFactor,
    power: c.extraPower,
    limit: c.speedLimit,
    reverse: c.allowReverse,
    tyre: r.tyres.compound,
    wear: r.tyres.wear,
    ers: r.ers,
    ersOn: r.ersActive,
    drs: r.drsOpen,
    drsOk: r.drsEligible,
    tow: r.slipstream,
    pit: r.pit.phase,
    pitEnds: r.pit.stopEnds,
    limiter: r.input.limiter,
    next: r.input.nextTyre,
    ack,
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
  c.damage = s.dmg;
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
    mandatoryStop: session.settings.mandatoryStop && session.settings.weather === 'dry',
    wetness: session.world.options.wetness,
    standings: session.standings(),
    quali: [...session.quali.entries()],
  };
}
