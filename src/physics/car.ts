import type { Surface, SurfaceType } from '../track/types';
import type { Slope, WallContact } from '../track/track';
import type { CarParams } from './carParams';

export interface DriverInput {
  throttle: number;
  brake: number;
  /** -1 = full left, 1 = full right. */
  steer: number;
}

/** What the car needs to know about the world around it. */
export interface CarWorld {
  /** hint: where on the track the car was last (see Car.trackIndex). */
  surfaceAt(x: number, y: number, hint?: number | null): Surface;
  /** carX/carY: the car centre, so two-sided walls (the pit wall) know which side it is on. */
  wallContact(x: number, y: number, carX: number, carY: number, hint?: number | null): WallContact | null;
  /** Which part of the track a point is on (a sample index), starting from a hint. */
  locate?(x: number, y: number, hint?: number | null, heading?: number | null): number | null;
  /** Hills: the slope at a sample index, or null where it's flat. */
  slope?(index: number | null): Slope | null;
}

const G = 9.81;
/** A wall hit unsettles the car less than a car hit (it bounces off rather than being shoved). */
const WALL_UPSET = 0.6;
/** What hit the car: walls are forgiving (only a wreck takes a wheel off). */
export type ImpactSource = 'car' | 'wall';
/** Limits on how much a crest or a dip changes the car's weight on the tyres. */
const MIN_WEIGHT = 0.3;
const MAX_WEIGHT = 1.8;

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
 * Parts that have come off the car, as bits of `Car.lost`. Wheels: front/rear, left/right.
 * Order matters: it is sent over the network as a number.
 */
export const LOST_FRONT_WING = 1;
export const LOST_REAR_WING = 2;
export const LOST_WHEEL_FL = 4;
export const LOST_WHEEL_FR = 8;
export const LOST_WHEEL_RL = 16;
export const LOST_WHEEL_RR = 32;

/** A part flying off the car, at a point in the car's own frame (x forward, y right). */
export interface ShedPart {
  kind: 'frontWing' | 'rearWing' | 'wheel' | 'shard';
  localX: number;
  localY: number;
  /** How hard the hit was (m/s), for how fast it flies off. */
  speed: number;
}

/** Hits harder than this (m/s, along the normal) knock the wings off. Only the big ones, like F1. */
export const FRONT_WING_OFF = 13;
export const REAR_WING_OFF = 15;
/** Another car hitting the side this hard breaks the suspension: the wheel comes off and the car is out. */
export const WHEEL_OFF = 19;
/** Hits from this speed leave a few carbon fibre shards on the track. */
const SHARDS_FROM = 9;
/** An upset car's tyres have lost their bite: a hit's spin and push carry on for a moment. */
const UPSET_FROM = 5;
const UPSET_RANGE = 15;
/** Upset fades this much per second (gone ~0.8 s after the biggest hit). */
const UPSET_DECAY = 1.25;

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
  /** Parts that came off (LOST_* bits). Lost wings work as fully damaged ones until the pits. */
  lost = 0;
  /**
   * 0..1 how unsettled the car is after a hit: the tyres hold less, and the steering has less
   * say over the car's rotation, so the spin and push from the impact play out (a spin-out after
   * a hard hit in the side or the rear) before the car settles again.
   */
  upset = 0;
  /** Host only: called when a part comes off, so the race world can put it on the track. */
  onShed?: (part: ShedPart) => void;

  // Set by the race world each step (tyres, weather, DRS, slipstream, ERS, pit limiter).
  /** Grip multiplier from tyres and weather. */
  gripFactor = 1;
  /** Aero drag multiplier (DRS, slipstream). */
  dragFactor = 1;
  /** Extra engine power (W), e.g. ERS deployment. */
  extraPower = 0;
  /** Pit limiter speed (m/s), or null when off. */
  speedLimit: number | null = null;
  /** Party mode: a straight push (N) forwards (boost) or back (pulled by a hook), beyond the engine and tyres. */
  push = 0;
  /** Holding the brake at a standstill reverses the car, except on the grid. */
  allowReverse = true;

  /** Share of grip in use (0..1) and whether the tyres are sliding: drives tyre wear. */
  tyreLoad = 0;
  sliding = false;

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
  /**
   * Which stretch of track the car is on (a sample index), followed step by step so that
   * where the track runs close to itself or crosses (Suzuka) it stays on its own road.
   * Null after a teleport: then it is looked up afresh.
   */
  trackIndex: number | null = null;

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

  /** Put the car somewhere, stopped. `trackIndex`: the stretch of track it is on, if known. */
  place(x: number, y: number, heading: number, trackIndex: number | null = null): void {
    this.trackIndex = trackIndex;
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
    this.lost = 0;
    this.upset = 0;
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
    if (this.trackIndex === null) this.trackIndex = world.locate?.(this.x, this.y, null, this.heading) ?? null;
    // Hills: the rise per metre along the nose, and how the road's curve changes the car's
    // weight on the tyres: light over a crest, pressed down in a dip (Eau Rouge).
    const slope = world.slope?.(this.trackIndex) ?? null;
    const uphill = slope ? slope.grade * (c * slope.tx + s * slope.ty) : 0;
    const weight = slope ? Math.max(MIN_WEIGHT, Math.min(MAX_WEIGHT, 1 + (vx * vx * slope.vcurv) / G)) : 1;
    const loadF = ((m * G * p.cgToRear) / L) * weight + downforce * p.aeroBalanceFront;
    const loadR = ((m * G * p.cgToFront) / L) * weight + downforce * (1 - p.aeroBalanceFront);
    const surfF = world.surfaceAt(this.x + c * p.cgToFront, this.y + s * p.cgToFront, this.trackIndex);
    const surfR = world.surfaceAt(this.x - c * p.cgToRear, this.y - s * p.cgToRear, this.trackIndex);
    this.surfaceFront = surfF.type;
    this.surfaceRear = surfR.type;
    const gripMul = (1 - 0.15 * sides) * this.gripFactor;
    // Unsettled after a hit: less grip to stop the slide, and the steering barely holds the spin.
    const upset = this.upset;
    this.upset = Math.max(0, upset - UPSET_DECAY * dt);
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
    const wantedFx = fx;
    fx = clampAbs(fx, grip * 0.98);

    // --- Lateral: tyres cancel sideways sliding, up to what's left of the grip.
    // Braking or accelerating hard leaves less grip for cornering, but only partly, so
    // braking into a corner while steering (natural on a keyboard) still turns the car.
    const longUse = fx / grip;
    const lateralGrip = grip * Math.sqrt(Math.max(0, 1 - p.combinedGripPenalty * longUse * longUse)) * (1 - 0.65 * upset);
    const wantedFy = (-m * vy) / dt;
    const fy = clampAbs(wantedFy, lateralGrip);
    // How hard the tyres are working, for tyre wear: share of grip used, and whether they
    // are sliding (asked for more than they can give: locking up, spinning, skidding wide).
    this.tyreLoad = Math.hypot(fx, fy) / Math.max(grip, 1);
    this.sliding = speed > 3 && (Math.abs(wantedFy) > lateralGrip * 1.02 || Math.abs(wantedFx) > grip);

    // --- Rotation: steering asks for a turn rate, capped by the tightest turn
    // the tyres can hold at this speed. Too fast for a corner = the car runs wide.
    const forward = Math.abs(vx);
    const geometricLimit = forward / p.minTurnRadius;
    const gripLimit = ((p.turnGripUse * lateralGrip) / m / Math.max(forward, 1)) * (1 - 0.4 * dmg.frontWing);
    // A damaged side drags the car towards it.
    const pull = 0.12 * (dmg.right - dmg.left) * Math.min(1, forward / 20);
    const steerIn = Math.max(-1, Math.min(1, this.steer + pull));
    const targetYaw = steerIn * Math.min(geometricLimit, gripLimit) * Math.sign(vx);
    this.yawRate += (targetYaw - this.yawRate) * Math.min(1, p.yawResponse * (1 - 0.9 * upset) * dt);

    // --- Resistance: aero drag, rolling resistance and surface drag.
    let fxTotal = fx;
    let fyTotal = fy;
    // A pull back only slows the car, never reverses it.
    if (this.push > 0 || (this.push < 0 && vx > 5)) fxTotal += this.push;
    // Gravity along the slope. Fades out when stopped with no throttle, so a parked car
    // (grid, pit box) doesn't creep.
    if (uphill !== 0) {
      const hold = this.throttle > 0.05 ? 1 : Math.min(1, speed / 2);
      fxTotal -= ((m * G * uphill) / Math.sqrt(1 + uphill * uphill)) * hold;
    }
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
    this.trackIndex = world.locate?.(this.x, this.y, this.trackIndex) ?? null;
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
      const hit = world.wallContact(this.x + rx, this.y + ry, this.prevX, this.prevY, this.trackIndex);
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

      this.impact(-vn, lx, ly, 'wall');
    }
  }

  /**
   * Take damage from a hit at this speed (m/s along the contact normal), at a point in the
   * car's own frame (x forward, y right). Where it hits decides which parts break; only the
   * hardest hits knock parts off (onto the track, see onShed). A big enough hit retires the car.
   */
  impact(impactSpeed: number, localX: number, localY: number, source: ImpactSource = 'car'): void {
    const p = this.params;
    this.lastImpact = impactSpeed;
    const upsetScale = source === 'wall' ? WALL_UPSET : 1;
    this.upset = Math.max(this.upset, Math.min(1, ((impactSpeed - UPSET_FROM) / UPSET_RANGE) * upsetScale));
    if (this.retired) return;
    const along = localX / (p.length / 2);
    const side: keyof CarParts = localY >= 0 ? 'right' : 'left';
    if (impactSpeed >= SHARDS_FROM) {
      const n = impactSpeed >= p.crashSpeed ? 4 : impactSpeed >= FRONT_WING_OFF ? 3 : 2;
      for (let i = 0; i < n; i++) this.shed('shard', localX, localY, impactSpeed);
    }
    if (impactSpeed > p.crashSpeed || (source === 'car' && Math.abs(along) <= 0.5 && impactSpeed >= WHEEL_OFF)) {
      this.retired = true;
      this.parts = { frontWing: 1, rearWing: 1, left: 1, right: 1 };
      // The wing at the end that hit, and the wheel nearest the hit; a huge one takes both on that side.
      if (along > 0.3) this.loseWing(LOST_FRONT_WING, impactSpeed);
      if (along < -0.3) this.loseWing(LOST_REAR_WING, impactSpeed);
      const right = localY >= 0;
      const front = localX >= 0;
      this.loseWheel(front, right, impactSpeed);
      if (impactSpeed > p.crashSpeed * 1.4) this.loseWheel(!front, right, impactSpeed);
    } else if (impactSpeed > p.damageThreshold) {
      const amount = (impactSpeed - p.damageThreshold) * p.damagePerSpeed;
      const add = (part: keyof CarParts, share: number) => {
        this.parts[part] = Math.min(p.maxDamage, this.parts[part] + amount * share);
      };
      if (along > 0.5) {
        add('frontWing', 1);
        add(side, 0.3);
        if (impactSpeed >= FRONT_WING_OFF) this.loseWing(LOST_FRONT_WING, impactSpeed);
      } else if (along < -0.5) {
        add('rearWing', 1);
        add(side, 0.3);
        if (impactSpeed >= REAR_WING_OFF) this.loseWing(LOST_REAR_WING, impactSpeed);
      } else {
        add(side, 1);
      }
    }
  }

  /** Debris on the track hit this point of the car (own frame) at this speed: a little damage, no parts off. */
  hitDebris(localX: number, localY: number, damage: number, upset: number): void {
    if (this.retired) return;
    const max = this.params.maxDamage;
    const part: keyof CarParts = localX > this.params.length / 4 ? 'frontWing' : localY >= 0 ? 'right' : 'left';
    this.parts[part] = Math.min(max, this.parts[part] + damage);
    this.upset = Math.max(this.upset, upset);
  }

  private loseWing(bit: number, speed: number): void {
    if (this.lost & bit) return;
    this.lost |= bit;
    const front = bit === LOST_FRONT_WING;
    // Without a wing the car drives as if it were fully broken (until the pit crew fit a new one).
    if (front) this.parts.frontWing = Math.max(this.parts.frontWing, this.params.maxDamage);
    else this.parts.rearWing = Math.max(this.parts.rearWing, this.params.maxDamage);
    const hl = this.params.length / 2;
    this.shed(front ? 'frontWing' : 'rearWing', front ? hl - 0.25 : -hl + 0.2, 0, speed);
  }

  private loseWheel(front: boolean, right: boolean, speed: number): void {
    const bit = front ? (right ? LOST_WHEEL_FR : LOST_WHEEL_FL) : right ? LOST_WHEEL_RR : LOST_WHEEL_RL;
    if (this.lost & bit) return;
    this.lost |= bit;
    const p = this.params;
    this.shed('wheel', front ? p.cgToFront : -p.cgToRear, (right ? 1 : -1) * (p.width / 2 - 0.2), speed);
  }

  private shed(kind: ShedPart['kind'], localX: number, localY: number, speed: number): void {
    this.onShed?.({ kind, localX, localY, speed });
  }
}

function approach(current: number, target: number, maxDelta: number): number {
  if (current < target) return Math.min(target, current + maxDelta);
  return Math.max(target, current - maxDelta);
}

function clampAbs(v: number, max: number): number {
  return v > max ? max : v < -max ? -max : v;
}
