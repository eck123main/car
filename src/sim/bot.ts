import type { Track } from '../track/track';
import { laneCentre } from './pit';
import type { Compound } from './tyres';
import { IDLE_INPUT, type PlayerInput, type Racer } from './world';

export interface BotOptions {
  /** Pit at the end of this lap (laps completed), if set. */
  pitOnLap?: number;
  nextTyre?: Compound;
  /** Cornering aggression: lateral grip assumed (m/s^2). */
  grip?: number;
  /** Hold the brakes (e.g. before lights out). */
  hold?: boolean;
  /** Lateral offset to drive at (m), to keep bots side by side. */
  offset?: number;
}

/**
 * Simple keyboard-style driver used in tests: aims ahead on the centreline and brakes
 * for upcoming corners. Not a racing AI.
 */
export function botInput(track: Track, r: Racer, opts: BotOptions = {}): PlayerInput {
  const base = { ...IDLE_INPUT, nextTyre: opts.nextTyre ?? r.input.nextTyre };
  if (opts.hold) return { ...base, brake: 1 };
  const car = r.car;
  const q = track.query(car.x, car.y);
  if (!q) return base;
  const ss = track.samples;
  const n = ss.length;

  const lane = track.pit;
  const wantsPit = opts.pitOnLap !== undefined && r.timer.lapsCompleted === opts.pitOnLap && r.pit.stops === 0;
  const pitting = lane && (r.pit.phase !== 'out' || (wantsPit && track.inRange(q.s, lane.entry, lane.wallStart)));
  const offset = pitting ? laneCentre(track, q.sample.halfWidth) : (opts.offset ?? 0);

  const aim = ss[(q.index + Math.round((8 + car.speed * 0.3) / 2)) % n];
  let err = Math.atan2(aim.y + aim.ny * offset - car.y, aim.x + aim.nx * offset - car.x) - car.heading;
  err = Math.atan2(Math.sin(err), Math.cos(err));
  let k = 0;
  for (let j = 0; j < 80; j++) {
    const a = ss[(q.index + j) % n];
    const b = ss[(q.index + j + 4) % n];
    k = Math.max(k, Math.abs(Math.atan2(a.tx * b.ty - a.ty * b.tx, a.tx * b.tx + a.ty * b.ty)) / 8);
  }
  let limit = Math.sqrt((opts.grip ?? 24) / Math.max(k, 1e-4));
  // Slow down for the pit entry.
  if (wantsPit && lane && track.forwardDistance(q.s, lane.entry) < 250) limit = Math.min(limit, 20);
  return {
    ...base,
    throttle: car.speed < limit ? 1 : 0,
    brake: car.speed > limit + 3 ? 1 : 0,
    steer: err > 0.02 ? 1 : err < -0.02 ? -1 : 0,
  };
}
