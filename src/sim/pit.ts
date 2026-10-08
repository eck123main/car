import type { Car } from '../physics/car';
import { PIT_LANE_INNER, PIT_LANE_WIDTH, type Track } from '../track/track';
import type { PlayerInput } from './world';

export const PIT_SPEED_LIMIT = 80 / 3.6;
/** Entering the pit lane faster than this (m/s) is a speeding penalty. */
const PIT_ENTRY_TOLERANCE = 20 / 3.6;
export const PIT_SPEEDING_PENALTY = 5;
/** Base stationary time, plus up to a second of crew variation, plus repair time per unit of damage. */
const STOP_BASE = 3;
const STOP_VARIATION = 1;
const REPAIR_TIME = 5;

/**
 * - out: on track.
 * - in: entered the pit lane; the car drives itself to its box.
 * - stopped: in the box, crew working.
 * - leaving: driver back in control, pit limiter forced on until the lane ends.
 */
export type PitPhase = 'out' | 'in' | 'stopped' | 'leaving';

export interface PitState {
  phase: PitPhase;
  box: number;
  stopEnds: number;
  stopDuration: number;
  stops: number;
}

export function newPitState(box: number): PitState {
  return { phase: 'out', box, stopEnds: 0, stopDuration: 0, stops: 0 };
}

export type PitEvent =
  | { kind: 'pitEntry'; speeding: boolean }
  | { kind: 'pitStopStarted'; duration: number }
  | { kind: 'pitStopDone' };

/** Lateral offset of the pit lane's centre from the track centreline (on the pit side). */
export function laneCentre(track: Track, halfWidth: number): number {
  return (halfWidth + PIT_LANE_INNER + PIT_LANE_WIDTH / 2) * (track.pit?.side ?? 1);
}

/**
 * The pit lane has a fast lane next to the pit wall for driving through, and a box lane on
 * the outside where cars stop, so a car in its box never blocks the others.
 */
export function fastLane(track: Track, halfWidth: number): number {
  return (halfWidth + PIT_LANE_INNER + 2.2) * (track.pit?.side ?? 1);
}

export function boxLane(track: Track, halfWidth: number): number {
  return (halfWidth + PIT_LANE_INNER + PIT_LANE_WIDTH - 2) * (track.pit?.side ?? 1);
}

/** Start moving over to the box lane this far before the box (m). */
const BOX_TURN_IN = 22;

/**
 * Advance a car's pit state. Returns the input to use this step (the autopilot's while
 * driving in), or 'hold' while the car sits in its box.
 */
export function updatePit(
  track: Track,
  pit: PitState,
  car: Car,
  input: PlayerInput,
  time: number,
  seed: string,
  events: PitEvent[],
  /** Other cars, so the autopilot doesn't drive into them. */
  others: readonly Car[] = [],
): PlayerInput | 'hold' {
  const lane = track.pit;
  if (!lane || car.retired) return input;
  const hit = track.query(car.x, car.y);
  if (!hit) return input;
  const inLane = hit.sample.pit && hit.d * lane.side > hit.sample.halfWidth + 0.5;
  // Entering needs a deliberate move: right across into the lane itself, not just a run wide.
  const committed = hit.sample.pit && hit.d * lane.side > hit.sample.halfWidth + PIT_LANE_INNER + 1;

  switch (pit.phase) {
    case 'out':
      // Entering means driving into the lane through the entry opening.
      // Anywhere along the lane: the pit wall (which cars cannot pass through) means a car in
      // the lane came in through the entry.
      if (committed && track.inRange(hit.s, lane.entry, lane.wallEnd) && car.forwardSpeed > 0) {
        pit.phase = 'in';
        events.push({ kind: 'pitEntry', speeding: car.speed > PIT_SPEED_LIMIT + PIT_ENTRY_TOLERANCE });
        return autopilot(track, pit, car, hit.s, input, time, seed, events, others);
      }
      return input;
    case 'in':
      if (!hit.sample.pit) {
        pit.phase = 'out';
        return input;
      }
      return autopilot(track, pit, car, hit.s, input, time, seed, events, others);
    case 'stopped':
      if (time < pit.stopEnds) return 'hold';
      pit.phase = 'leaving';
      pit.stops++;
      events.push({ kind: 'pitStopDone' });
      return { ...input, limiter: true };
    case 'leaving':
      // Done once the car is past the lane, or back on track after the pit wall ends.
      if (!hit.sample.pit || (!inLane && !track.inRange(hit.s, lane.entry, lane.wallEnd))) pit.phase = 'out';
      return { ...input, limiter: true };
  }
}

/** Drive along the lane centre to the box and stop there. */
function autopilot(
  track: Track,
  pit: PitState,
  car: Car,
  s: number,
  input: PlayerInput,
  time: number,
  seed: string,
  events: PitEvent[],
  others: readonly Car[],
): PlayerInput {
  const lane = track.pit!;
  const boxS = lane.boxes[pit.box % lane.boxes.length];
  const laneLength = track.forwardDistance(lane.entry, lane.exit);
  let toBox = track.forwardDistance(s, boxS);
  if (toBox > laneLength) toBox = 0; // just past the box: stop here

  if (toBox < 1.2 && car.speed < 1) {
    pit.phase = 'stopped';
    pit.stopDuration = STOP_BASE + STOP_VARIATION * pseudoRandom(seed, pit.stops) + REPAIR_TIME * car.damage;
    pit.stopEnds = time + pit.stopDuration;
    events.push({ kind: 'pitStopStarted', duration: pit.stopDuration });
    return { ...input, throttle: 0, brake: 1, steer: 0, limiter: true };
  }

  const n = track.samples.length;
  const aimS = s + Math.min(12, Math.max(toBox, 4));
  const aim = track.samples[Math.floor(aimS / 2) % n];
  // Fast lane until close to the box, then over into the box lane.
  const toBoxFromAim = toBox - Math.min(12, Math.max(toBox, 4));
  const blend = Math.max(0, Math.min(1, 1 - toBoxFromAim / BOX_TURN_IN));
  const offset = fastLane(track, aim.halfWidth) + (boxLane(track, aim.halfWidth) - fastLane(track, aim.halfWidth)) * blend;
  const ax = aim.x + aim.nx * offset;
  const ay = aim.y + aim.ny * offset;
  let err = Math.atan2(ay - car.y, ax - car.x) - car.heading;
  err = Math.atan2(Math.sin(err), Math.cos(err));
  let target = Math.min(PIT_SPEED_LIMIT - 0.5, Math.sqrt(2 * 5 * Math.max(0, toBox - 0.8)));
  // Keep a safe gap to any car ahead in our lane.
  const fx = Math.cos(car.heading);
  const fy = Math.sin(car.heading);
  for (const o of others) {
    const dx = o.x - car.x;
    const dy = o.y - car.y;
    const ahead = dx * fx + dy * fy;
    const side = Math.abs(-dx * fy + dy * fx);
    if (ahead <= 0 || ahead > 40 || side > 2.6) continue;
    const safe = 7 + car.speed * 0.3;
    target = Math.min(target, Math.max(0, o.speed + (ahead - safe) * 0.5));
  }
  return {
    ...input,
    throttle: car.speed < target - 0.3 ? 1 : 0,
    brake: car.speed > target + 0.3 ? 1 : 0,
    steer: Math.max(-1, Math.min(1, err * 3)),
    limiter: true,
    drs: false,
    ers: false,
  };
}

/** Deterministic 0..1 so every machine gets the same stop time. */
function pseudoRandom(seed: string, n: number): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  const x = Math.sin(h * 0.001 + n * 7.13) * 10_000;
  return x - Math.floor(x);
}
