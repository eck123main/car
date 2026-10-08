import type { Surface, SurfaceType } from '../track/types';
import type { WallContact } from '../track/track';
import type { CarParams } from './carParams';

export interface DriverInput {
  throttle: number;
  brake: number;
  /** -1 = full left, 1 = full right. */
  steer: number;
}

/** What the car needs to know about the world around it. */
export interface CarWorld {
  surfaceAt(x: number, y: number): Surface;
  /** carX/carY: the car centre, so two-sided walls (the pit wall) know which side it is on. */
  wallContact(x: number, y: number, carX: number, carY: number): WallContact | null;
}

const G = 9.81;

/** Damage per part, 0 (fine) to 1 (destroyed). */
export interface CarParts {
  frontWing: number;
  rearWing: number;
  left: number;
  right: number;
}

export const PART_NAMES: Record<keyof CarParts, string> = {
  frontWing: 'Front wing',
  rearWing: 'Rear wing',
  left: 'Left side',
  right: 'Right side',
};

const noDamage = (): CarParts => ({ frontWing: 0, rearWing: 0, left: 0, right: 0 });

/**
 * Top-down car: grip from weight + downforce, shared between braking/accelerating and
 * cornering. Steering sets a turn rate capped by that grip, so the car runs wide
 * instead of spinning. Local frame: x = forward, y = right.
 */
export class Car {
  x = 0;
  y = 0;
  heading = 0;
  vx = 0;
  vy = 0;
  yawRate = 0;

  steer = 0;
  throttle = 0;
  brake = 0;

  /** Damage to each part (see the effects in step()). */
  parts: CarParts = noDamage();
  retired = false;
  lastImpact = 0;

  // Set by the race world each step (tyres, weather, DRS, slipstream, ERS, pit limiter).
  /** Grip multiplier from tyres and weather. */
  gripFactor = 1;
  /** Aero drag multiplier (DRS, slipstream). */
  dragFactor = 1;
  /** Extra engine power (W), e.g. ERS deployment. */
  extraPower = 0;
  /** Pit limiter speed (m/s), or null when off. */
  speedLimit: number | null = null;
  /** Holding the brake at a standstill reverses the car, except on the grid. */
  allowReverse = true;

  /** For the HUD. */
  latG = 0;
  longG = 0;
  surfaceFront: SurfaceType = 'asphalt';
  surfaceRear: SurfaceType = 'asphalt';

  prevX = 0;
  prevY = 0;
  prevHeading = 0;

  constructor(
    readonly params: CarParams,
    readonly color: string,
  ) {}

  /** Overall damage: the worst part. 1 = retired. */
  get damage(): number {
    const d = this.parts;
    return Math.max(d.frontWing, d.rearWing, d.left, d.right);
  }

  get speed(): number {
    return Math.hypot(this.vx, this.vy);
  }

  /** Signed speed along the car's nose. */
  get forwardSpeed(): number {
    return this.vx * Math.cos(this.heading) + this.vy * Math.sin(this.heading);
  }

  place(x: number, y: number, heading: number): void {
    this.x = this.prevX = x;
    this.y = this.prevY = y;
    this.heading = this.prevHeading = heading;
    this.vx = this.vy = this.yawRate = 0;
    this.steer = this.throttle = this.brake = 0;
  }

  repair(): void {
    this.parts = noDamage();
    this.retired = false;
    this.lastImpact = 0;
  }

  step(input: DriverInput, dt: number, world: CarWorld): void {
    const p = this.params;
    this.prevX = this.x;
    this.prevY = this.y;
    this.prevHeading = this.heading;

    const c = Math.cos(this.heading);
    const s = Math.sin(this.heading);
    const vx = this.vx * c + this.vy * s;
    const vy = -this.vx * s + this.vy * c;
    const v2 = vx * vx + vy * vy;
    const speed = Math.sqrt(v2);
    const m = p.mass;

    // --- Driver controls, ramped because keyboard input is on/off.
    const wantThrottle = this.retired ? 0 : input.throttle;
    const wantBrake = this.retired ? 1 : input.brake;
    const wantSteer = this.retired ? 0 : input.steer;
    this.throttle = approach(this.throttle, wantThrottle, p.throttleRate * dt);
    this.brake = approach(this.brake, wantBrake, p.brakeRate * dt);
    const centring = Math.abs(wantSteer) < Math.abs(this.steer) || wantSteer * this.steer < 0;
    this.steer = approach(this.steer, wantSteer, (centring ? p.steerReturnRate : p.steerRate) * dt);

    // --- Grip: weight + downforce, per axle so each axle feels its own surface.
    const L = p.cgToFront + p.cgToRear;
    // Damage effects, per part:
    //   front wing -> less front grip, so the car won't turn in (understeer)
    //   rear wing  -> less downforce (slower in fast corners) and a little less power
    //   sides      -> more drag (slower on straights), less grip, and a pull to that side
    const dmg = this.parts;
    const sides = (dmg.left + dmg.right) / 2;
    const downforce = p.downforceCoef * v2 * (1 - 0.45 * dmg.rearWing);
    const loadF = (m * G * p.cgToRear) / L + downforce * p.aeroBalanceFront;
    const loadR = (m * G * p.cgToFront) / L + downforce * (1 - p.aeroBalanceFront);
    const surfF = world.surfaceAt(this.x + c * p.cgToFront, this.y + s * p.cgToFront);
    const surfR = world.surfaceAt(this.x - c * p.cgToRear, this.y - s * p.cgToRear);
    this.surfaceFront = surfF.type;
    this.surfaceRear = surfR.type;
    const gripMul = (1 - 0.15 * sides) * this.gripFactor;
    const grip = p.mu * gripMul * (surfF.grip * loadF + surfR.grip * loadR);

    // --- Longitudinal: engine, brakes, reverse. Limited by grip (no wheelspin or lockups).
    const reversing = this.allowReverse && input.brake > 0 && input.throttle === 0 && vx < 1.5 && !this.retired;
    let fx = 0;
    if (reversing) {
      if (vx > -p.maxReverseSpeed) fx -= p.reverseForce;
    } else {
      const power = p.power * (1 - 0.12 * dmg.rearWing) + this.extraPower;
      const rearGrip = p.mu * gripMul * surfR.grip * loadR;
      const limited = this.speedLimit !== null && vx > this.speedLimit - 0.3;
      if (!limited) fx += Math.min(rearGrip, this.throttle * Math.min(p.maxDriveForce, power / Math.max(vx, 1)));
      // The limiter also gently brakes a car that enters the pit lane too fast.
      if (this.speedLimit !== null && vx > this.speedLimit + 1) fx -= m * 4;
      const brakeForce = this.brake * p.brakeGrip * p.mu * gripMul * (loadF + loadR);
      fx -= Math.sign(vx) * Math.min(brakeForce, (m * Math.abs(vx)) / dt);
    }
    fx = clampAbs(fx, grip * 0.98);

    // --- Lateral: tyres cancel sideways sliding, up to what's left of the grip.
    // Braking or accelerating hard leaves less grip for cornering, but only partly, so
    // braking into a corner while steering (natural on a keyboard) still turns the car.
    const longUse = fx / grip;
    const lateralGrip = grip * Math.sqrt(Math.max(0, 1 - p.combinedGripPenalty * longUse * longUse));
    const fy = clampAbs((-m * vy) / dt, lateralGrip);

    // --- Rotation: steering asks for a turn rate, capped by the tightest turn
    // the tyres can hold at this speed. Too fast for a corner = the car runs wide.
    const forward = Math.abs(vx);
    const geometricLimit = forward / p.minTurnRadius;
    const gripLimit = ((p.turnGripUse * lateralGrip) / m / Math.max(forward, 1)) * (1 - 0.4 * dmg.frontWing);
    // A damaged side drags the car towards it.
    const pull = 0.12 * (dmg.right - dmg.left) * Math.min(1, forward / 20);
    const steerIn = Math.max(-1, Math.min(1, this.steer + pull));
    const targetYaw = steerIn * Math.min(geometricLimit, gripLimit) * Math.sign(vx);
    this.yawRate += (targetYaw - this.yawRate) * Math.min(1, p.yawResponse * dt);

    // --- Resistance: aero drag, rolling resistance and surface drag.
    let fxTotal = fx;
    let fyTotal = fy;
    if (speed > 1e-3) {
      const drag = p.dragCoef * this.dragFactor * (1 + 0.35 * sides + 0.1 * dmg.frontWing) * v2;
      const surfaceDrag = surfF.drag + surfR.drag + (surfF.dragPerSpeed + surfR.dragPerSpeed) * speed;
      const rolling = p.rollingResistance * m * G + (m * surfaceDrag) / 2;
      const resist = Math.min(drag + rolling, (m * speed) / dt);
      fxTotal -= (resist * vx) / speed;
      fyTotal -= (resist * vy) / speed;
    }

    const ax = fxTotal / m;
    const ay = fyTotal / m;
    this.longG = ax / G;
    this.latG = (vx * this.yawRate) / G;

    // --- Integrate (semi-implicit Euler) in world space.
    this.vx += (ax * c - ay * s) * dt;
    this.vy += (ax * s + ay * c) * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.heading += this.yawRate * dt;

    this.collideWalls(world);
  }

  private collideWalls(world: CarWorld): void {
    const p = this.params;
    const hl = p.length / 2;
    const hw = p.width / 2;
    const corners: [number, number][] = [
      [hl, -hw],
      [hl, hw],
      [-hl, -hw],
      [-hl, hw],
    ];
    const invM = 1 / p.mass;
    const invI = 1 / p.inertia;
    for (const [lx, ly] of corners) {
      const c = Math.cos(this.heading);
      const s = Math.sin(this.heading);
      const rx = c * lx - s * ly;
      const ry = s * lx + c * ly;
      // Which side of a two-sided wall (the pit wall) we are on is decided by where the car
      // was before this step, so a hard hit can never carry it through to the other side.
      const hit = world.wallContact(this.x + rx, this.y + ry, this.prevX, this.prevY);
      if (!hit) continue;
      this.x += hit.nx * hit.depth;
      this.y += hit.ny * hit.depth;

      const vpx = this.vx - this.yawRate * ry;
      const vpy = this.vy + this.yawRate * rx;
      const vn = vpx * hit.nx + vpy * hit.ny;
      if (vn >= 0) continue;

      const rn = rx * hit.ny - ry * hit.nx;
      const j = (-(1 + p.wallRestitution) * vn) / (invM + rn * rn * invI);
      this.vx += j * hit.nx * invM;
      this.vy += j * hit.ny * invM;
      this.yawRate += rn * j * invI;

      // Scrape along the wall.
      const tx = -hit.ny;
      const ty = hit.nx;
      const vt = vpx * tx + vpy * ty;
      const rt = rx * ty - ry * tx;
      const jt = clampAbs(-vt / (invM + rt * rt * invI), p.wallFriction * j);
      this.vx += jt * tx * invM;
      this.vy += jt * ty * invM;
      this.yawRate += rt * jt * invI;

      this.impact(-vn, lx, ly);
    }
  }

  /**
   * Take damage from a hit at this speed (m/s along the contact normal), at a point in the
   * car's own frame (x forward, y right). Where it hits decides which parts break.
   * A big enough hit retires the car.
   */
  impact(impactSpeed: number, localX: number, localY: number): void {
    const p = this.params;
    this.lastImpact = impactSpeed;
    if (this.retired) return;
    if (impactSpeed > p.crashSpeed) {
      this.retired = true;
      this.parts = { frontWing: 1, rearWing: 1, left: 1, right: 1 };
    } else if (impactSpeed > p.damageThreshold) {
      const amount = (impactSpeed - p.damageThreshold) * p.damagePerSpeed;
      const along = localX / (p.length / 2);
      const side: keyof CarParts = localY >= 0 ? 'right' : 'left';
      const add = (part: keyof CarParts, share: number) => {
        this.parts[part] = Math.min(p.maxDamage, this.parts[part] + amount * share);
      };
      if (along > 0.5) {
        add('frontWing', 1);
        add(side, 0.3);
      } else if (along < -0.5) {
        add('rearWing', 1);
        add(side, 0.3);
      } else {
        add(side, 1);
      }
    }
  }
}

function approach(current: number, target: number, maxDelta: number): number {
  if (current < target) return Math.min(target, current + maxDelta);
  return Math.max(target, current - maxDelta);
}

function clampAbs(v: number, max: number): number {
  return v > max ? max : v < -max ? -max : v;
}
