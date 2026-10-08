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
  wallContact(x: number, y: number): WallContact | null;
}

const G = 9.81;

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

  /** 0..1. Lowers grip and power. 1 = retired. */
  damage = 0;
  retired = false;
  lastImpact = 0;

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
    this.damage = 0;
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
    const downforce = p.downforceCoef * v2 * (1 - 0.2 * this.damage);
    const loadF = (m * G * p.cgToRear) / L + downforce * p.aeroBalanceFront;
    const loadR = (m * G * p.cgToFront) / L + downforce * (1 - p.aeroBalanceFront);
    const surfF = world.surfaceAt(this.x + c * p.cgToFront, this.y + s * p.cgToFront);
    const surfR = world.surfaceAt(this.x - c * p.cgToRear, this.y - s * p.cgToRear);
    this.surfaceFront = surfF.type;
    this.surfaceRear = surfR.type;
    const gripMul = 1 - 0.25 * this.damage;
    const grip = p.mu * gripMul * (surfF.grip * loadF + surfR.grip * loadR);

    // --- Longitudinal: engine, brakes, reverse. Limited by grip (no wheelspin or lockups).
    const reversing = input.brake > 0 && input.throttle === 0 && vx < 1.5 && !this.retired;
    let fx = 0;
    if (reversing) {
      if (vx > -p.maxReverseSpeed) fx -= p.reverseForce;
    } else {
      const power = p.power * (1 - 0.2 * this.damage);
      const rearGrip = p.mu * gripMul * surfR.grip * loadR;
      fx += Math.min(rearGrip, this.throttle * Math.min(p.maxDriveForce, power / Math.max(vx, 1)));
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
    const gripLimit = (p.turnGripUse * lateralGrip) / m / Math.max(forward, 1);
    const targetYaw = this.steer * Math.min(geometricLimit, gripLimit) * Math.sign(vx);
    this.yawRate += (targetYaw - this.yawRate) * Math.min(1, p.yawResponse * dt);

    // --- Resistance: aero drag, rolling resistance and surface drag.
    let fxTotal = fx;
    let fyTotal = fy;
    if (speed > 1e-3) {
      const drag = p.dragCoef * (1 + 0.3 * this.damage) * v2;
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
      const hit = world.wallContact(this.x + rx, this.y + ry);
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

      this.registerImpact(-vn);
    }
  }

  private registerImpact(impactSpeed: number): void {
    const p = this.params;
    this.lastImpact = impactSpeed;
    if (this.retired) return;
    if (impactSpeed > p.crashSpeed) {
      this.retired = true;
      this.damage = 1;
    } else if (impactSpeed > p.damageThreshold) {
      this.damage = Math.min(p.maxDamage, this.damage + (impactSpeed - p.damageThreshold) * p.damagePerSpeed);
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
