import type { Track } from '../track/track';
import type { IdealLine } from './ai/idealLine';
import { CAR_CLASSES } from './carClass';
import { ERS_POWER, type PlayerInput, type Racer } from './world';

/**
 * Auto ERS (a driving aid, Settings "Auto ERS"): decides each frame whether to deploy, so the
 * player never touches Shift.
 *
 * The battery drains at a fixed rate while deploying, so the question is where a second of
 * deployment is worth most. Extra power only adds drive once the engine is past its traction
 * limit (`maxDriveForce`, ~190 km/h on the F1), and the speed it adds lasts until the next
 * braking zone. So a second of ERS is worth about (extra acceleration / speed) x (time left
 * to the braking point): best early on a long straight, worthless just before braking. It
 * deploys when that is worth more than the battery is (the emptier, the pickier), and always
 * when the battery is full, as charging would be wasted.
 */
export function autoErs(track: Track, ideal: IdealLine, r: Racer, input: PlayerInput): boolean {
  const car = r.car;
  const cls = CAR_CLASSES[r.carClass];
  if (!cls.ers || r.ers <= 0 || car.retired || car.speed < (cls.ersFrom ?? 0)) return false;
  if (input.throttle < 0.9 || input.brake > 0 || input.limiter || r.pit.phase !== 'out') return false;
  const v = car.speed;
  const p = car.params;
  const gain = Math.min(p.maxDriveForce, (p.power + ERS_POWER) / v) - Math.min(p.maxDriveForce, p.power / v);
  if (!(gain > 0)) return false;
  if (r.ers >= FULL) return true;
  const ahead = timeToBraking(track, ideal, car.x, car.y, car.trackIndex, v);
  const worth = (gain / p.mass / v) * ahead;
  return worth >= WORTH * (1 - r.ers);
}

/** Battery this full: deploy anywhere it adds drive. */
const FULL = 0.97;
/** What a second of ERS must be worth with an empty battery (scaled by how empty it is). */
const WORTH = 0.02;
/** Looking further than this (s) to the braking point changes nothing. */
const LOOK = 5;

/** Seconds at this speed until the ideal line says brake (up to `LOOK`). */
function timeToBraking(track: Track, ideal: IdealLine, x: number, y: number, hint: number | null, v: number): number {
  const q = track.query(x, y, hint);
  if (!q) return 0;
  const n = track.samples.length;
  const ds = track.length / n;
  const steps = Math.min(n, Math.ceil((LOOK * v) / ds));
  for (let k = 1; k <= steps; k++) {
    if (ideal.cue[(q.index + k) % n] === 2) return (k * ds) / v;
  }
  return LOOK;
}
