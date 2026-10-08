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
 * Top-down car with a two-axle (bicycle) tyre model, downforce, drag and a
 * friction circle per axle. Local frame: x = forward, y = right.
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

  private accelPrev = 0;

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
    this.accelPrev = 0;
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

    // --- Driver controls, ramped because keyboard input is on/off.
    const wantThrottle = this.retired ? 0 : input.throttle;
    const wantBrake = this.retired ? 1 : input.brake;
    const wantSteer = this.retired ? 0 : input.steer;
    this.throttle = approach(this.throttle, wantThrottle, p.throttleRate * dt);
    this.brake = approach(this.brake, wantBrake, p.brakeRate * dt);
    const maxSteer = Math.max(p.maxSteerHigh, p.maxSteerLow / (1 + speed / p.steerSpeedRef));
    const steerTarget = wantSteer * maxSteer;
    const centring = Math.abs(steerTarget) < Math.abs(this.steer) || steerTarget * this.steer < 0;
    this.steer = approach(this.steer, steerTarget, (centring ? p.steerReturnRate : p.steerRate) * dt);

    // --- Axle loads: static weight + downforce + longitudinal weight transfer.
    const a = p.cgToFront;
    const b = p.cgToRear;
    const L = a + b;
    const m = p.mass;
    const downforce = p.downforceCoef * v2 * (1 - 0.2 * this.damage);
    const transfer = (m * this.accelPrev * p.cgHeight) / L;
    const minLoad = 0.1 * m * G;
    const loadF = Math.max(minLoad, (m * G * b) / L + downforce * p.aeroBalanceFront - transfer);
    const loadR = Math.max(minLoad, (m * G * a) / L + downforce * (1 - p.aeroBalanceFront) + transfer);
    const massF = (m * b) / L;
    const massR = (m * a) / L;

    // --- Surface under each axle.
    const surfF = world.surfaceAt(this.x + c * a, this.y + s * a);
    const surfR = world.surfaceAt(this.x - c * b, this.y - s * b);
    this.surfaceFront = surfF.type;
    this.surfaceRear = surfR.type;
    const gripMul = 1 - 0.25 * this.damage;
    const capF = p.mu * surfF.grip * gripMul * loadF;
    const capR = p.mu * p.rearGripBias * surfR.grip * gripMul * loadR;

    // --- Lateral tyre forces from slip angles.
    const cd = Math.cos(this.steer);
    const sd = Math.sin(this.steer);
    const vyFront = vy + this.yawRate * a;
    const vxWheelF = vx * cd + vyFront * sd;
    const vyWheelF = -vx * sd + vyFront * cd;
    const slipF = Math.atan2(vyWheelF, Math.max(Math.abs(vxWheelF), 1));
    // Never apply more force than it takes to stop the sideways motion this step.
    let fyF = clampAbs(-this.tyre(slipF) * capF, (massF * Math.abs(vyWheelF)) / dt);

    const vyRear = vy - this.yawRate * b;
    const slipR = Math.atan2(vyRear, Math.max(Math.abs(vx), 1));
    let fyR = clampAbs(-this.tyre(slipR) * capR, (massR * Math.abs(vyRear)) / dt);

    // --- Longitudinal forces: brakes, engine, reverse.
    const reversing = input.brake > 0 && input.throttle === 0 && vx < 1.5 && !this.retired;
    const brake = reversing ? 0 : this.brake;
    const brakeCap = p.brakeGrip * p.mu * gripMul * (loadF + loadR);
    let fxF = -Math.sign(vxWheelF) * Math.min(brake * brakeCap * p.brakeBiasFront, (massF * Math.abs(vxWheelF)) / dt);
    let fxR = -Math.sign(vx) * Math.min(brake * brakeCap * (1 - p.brakeBiasFront), (massR * Math.abs(vx)) / dt);

    if (reversing) {
      if (vx > -p.maxReverseSpeed) fxR -= p.reverseForce;
    } else if (this.throttle > 0) {
      const power = p.power * (1 - 0.2 * this.damage);
      let drive = this.throttle * Math.min(p.maxDriveForce, power / Math.max(vx, 1));
      const lateralUsed = Math.abs(fyR) * p.tractionAssist;
      drive = Math.min(drive, Math.sqrt(Math.max(0, capR * capR - lateralUsed * lateralUsed)));
      fxR += drive;
    }

    // --- Friction circle: longitudinal force eats into lateral grip.
    [fxF, fyF] = frictionCircle(fxF, fyF, capF);
    [fxR, fyR] = frictionCircle(fxR, fyR, capR);

    // Front tyre forces into the car frame.
    const fxFront = fxF * cd - fyF * sd;
    const fyFront = fxF * sd + fyF * cd;

    // --- Resistance: aero drag, rolling resistance and surface drag.
    let fx = fxFront + fxR;
    let fy = fyFront + fyR;
    if (speed > 1e-3) {
      const drag = p.dragCoef * (1 + 0.3 * this.damage) * v2;
      const rolling = p.rollingResistance * m * G + (m * (surfF.drag + surfR.drag)) / 2;
      const resist = Math.min(drag + rolling, (m * speed) / dt);
      fx -= (resist * vx) / speed;
      fy -= (resist * vy) / speed;
    }
    const torque = a * fyFront - b * fyR;

    const ax = fx / m;
    const ay = fy / m;
    this.accelPrev += (ax - this.accelPrev) * Math.min(1, dt * 20);
    this.longG = ax / G;
    this.latG = ay / G;

    // --- Integrate (semi-implicit Euler) in world space.
    this.vx += (ax * c - ay * s) * dt;
    this.vy += (ax * s + ay * c) * dt;
    this.yawRate += (torque / p.inertia) * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.heading += this.yawRate * dt;

    this.collideWalls(world);
  }

  private tyre(slip: number): number {
    return Math.sin(this.params.tyreC * Math.atan(this.params.tyreB * slip));
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

/** Keep the combined tyre force inside the grip limit. A locked or spinning wheel keeps little side grip. */
function frictionCircle(fx: number, fy: number, cap: number): [number, number] {
  if (fx * fx + fy * fy <= cap * cap) return [fx, fy];
  if (Math.abs(fx) > cap) fx = Math.sign(fx) * cap * 0.9;
  const fyMax = Math.sqrt(Math.max(0, cap * cap - fx * fx));
  return [fx, clampAbs(fy, fyMax)];
}
