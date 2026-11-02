import type { SurfaceType } from '../track/types';

/**
 * How the driver's head moves in the cockpit (looks only): g-forces push it around on a
 * spring (forwards under braking, out of the corner when turning, back when accelerating),
 * kerbs and gravel shake it, and a hit jolts it. Onboard cameras bolted to the car only get
 * the shaking.
 */

/** What the head reacts to, once a frame. */
export interface Feel {
  /** Longitudinal and lateral g (Car.longG / latG: + = accelerating / turning right). */
  longG: number;
  latG: number;
  /** m/s */
  speed: number;
  /** The roughest surface under the car. */
  surface: SurfaceType;
  /** Car.upset (0-1): jumps up when the car is hit. */
  upset: number;
}

/** How far a car is sliding: direction of travel against its nose (rad, + = moving to its right). */
export function slipAngle(vx: number, vy: number, heading: number): number {
  const fwd = vx * Math.cos(heading) + vy * Math.sin(heading);
  const side = -vx * Math.sin(heading) + vy * Math.cos(heading);
  return Math.atan2(side, Math.abs(fwd));
}

/** Head offset (m, car frame: x forward, y up, z right) and turn (rad). */
export interface HeadPose {
  x: number;
  y: number;
  z: number;
  /** + = head tilted to the left (the view turns clockwise). */
  roll: number;
  /** + = looking up. */
  pitch: number;
  /** The shaking part alone (m, roughly), for cameras bolted to the car and the steering wheel. */
  shake: number;
}

/** Head travel per g (m) and the most it moves. */
const SHIFT_PER_G = 0.012;
const SHIFT_MAX = 0.05;
const ROLL_PER_G = 0.015;
const ROLL_MAX = 0.06;
const NOD_PER_G = 0.01;
const NOD_MAX = 0.04;
/** Neck spring: stiffness (1/s²) and damping (1/s); a little bounce, settles in ~0.4 s. */
const STIFF = 90;
const DAMP = 12;

const clamp = (v: number, m: number) => Math.max(-m, Math.min(m, v));

/** One axis on a spring. */
class Spring {
  pos = 0;
  vel = 0;
  step(target: number, dt: number): number {
    this.vel += ((target - this.pos) * STIFF - this.vel * DAMP) * dt;
    this.pos += this.vel * dt;
    return this.pos;
  }
}

export class HeadMotion {
  private readonly fwd = new Spring();
  private readonly side = new Spring();
  private readonly roll = new Spring();
  private readonly nod = new Spring();
  private lastUpset = 0;
  private jolt = 0;
  private time = 0;
  /** Random numbers for the shaking (tests pass a fixed one). */
  constructor(private readonly random: () => number = Math.random) {}

  step(f: Feel, dt: number): HeadPose {
    dt = Math.min(dt, 0.05);
    this.time += dt;
    // A hit: the upset jumps; the head gets a kick and the shaking flares up.
    const hit = f.upset - this.lastUpset;
    this.lastUpset = f.upset;
    if (hit > 0.05) {
      this.jolt = Math.min(1, Math.max(this.jolt, hit * 1.5));
      this.side.vel += (this.random() - 0.5) * hit * 2.5;
      this.fwd.vel += hit * 1.2;
    }
    this.jolt *= Math.exp(-6 * dt);

    const x = this.fwd.step(clamp(-f.longG * SHIFT_PER_G, SHIFT_MAX), dt);
    const z = this.side.step(clamp(-f.latG * SHIFT_PER_G, SHIFT_MAX), dt);
    const roll = this.roll.step(clamp(f.latG * ROLL_PER_G, ROLL_MAX), dt);
    const pitch = this.nod.step(clamp(f.longG * NOD_PER_G, NOD_MAX), dt);

    // Shaking: a buzz at speed, kerbs drumming, gravel and grass rough, a hit violent.
    const fast = Math.min(1, f.speed / 30);
    const rough = f.speed < 1 ? 0 : f.surface === 'gravel' ? 0.014 : f.surface === 'grass' ? 0.008 : f.surface === 'kerb' ? 0.006 : 0;
    const buzz = 0.0012 * Math.min(1, f.speed / 90);
    // Kerbs: a steady drum from the stripes passing under the tyres.
    const drum = f.surface === 'kerb' ? Math.sin(this.time * 2 * Math.PI * Math.min(40, f.speed / 2)) : this.random() * 2 - 1;
    const amp = rough * fast + buzz + this.jolt * 0.05;
    const shakeY = amp * drum;
    const shakeZ = amp * 0.6 * (this.random() * 2 - 1);
    return {
      x,
      y: shakeY,
      z: z + shakeZ,
      roll: roll + amp * 1.5 * (this.random() * 2 - 1),
      pitch,
      shake: amp,
    };
  }
}
