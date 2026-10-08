/** Tunable car parameters. SI units (kg, m, s, N, W) unless noted. */
export interface CarParams {
  mass: number;
  /** Yaw moment of inertia (kg m^2). */
  inertia: number;
  cgToFront: number;
  cgToRear: number;
  cgHeight: number;
  length: number;
  width: number;

  /** Peak tyre friction coefficient on dry asphalt. */
  mu: number;
  /** Extra rear grip so the car prefers to understeer rather than spin. */
  rearGripBias: number;
  /** Simplified Pacejka shape: force = sin(C * atan(B * slip)). */
  tyreB: number;
  tyreC: number;

  power: number;
  /** Caps drive force at low speed. */
  maxDriveForce: number;
  /** Fraction of the asphalt grip limit the brakes can use. */
  brakeGrip: number;
  brakeBiasFront: number;
  /** 0 = no help, 1 = full traction control. Keyboard throttle is on/off, so some is needed. */
  tractionAssist: number;

  /** Drag force = dragCoef * v^2. */
  dragCoef: number;
  /** Downforce = downforceCoef * v^2. */
  downforceCoef: number;
  aeroBalanceFront: number;
  rollingResistance: number;

  /** Max steering angle (rad) at standstill and at high speed. */
  maxSteerLow: number;
  maxSteerHigh: number;
  steerSpeedRef: number;
  /** Steering speed (rad/s) when turning in and when centring. */
  steerRate: number;
  steerReturnRate: number;
  throttleRate: number;
  brakeRate: number;

  reverseForce: number;
  maxReverseSpeed: number;

  wallRestitution: number;
  wallFriction: number;
  /** Impact speeds (m/s, along the wall normal). */
  damageThreshold: number;
  crashSpeed: number;
  /** Damage gained per m/s of impact above the threshold. */
  damagePerSpeed: number;
  /** Damage cap below a crash, so the car can always reach the pits. */
  maxDamage: number;
}

/** Roughly modelled on a modern F1 car. Every car uses the same params for now. */
export const F1_CAR: CarParams = {
  mass: 800,
  inertia: 1100,
  cgToFront: 1.95,
  cgToRear: 1.65,
  cgHeight: 0.3,
  length: 5.6,
  width: 1.9,

  mu: 1.75,
  rearGripBias: 1.12,
  tyreB: 30,
  tyreC: 1.2,

  power: 740_000,
  maxDriveForce: 14_000,
  brakeGrip: 0.85,
  brakeBiasFront: 0.57,
  tractionAssist: 1,

  dragCoef: 0.85,
  downforceCoef: 2.4,
  aeroBalanceFront: 0.42,
  rollingResistance: 0.015,

  maxSteerLow: 0.4,
  maxSteerHigh: 0.1,
  steerSpeedRef: 22,
  steerRate: 4.5,
  steerReturnRate: 6,
  throttleRate: 6,
  brakeRate: 8,

  reverseForce: 5000,
  maxReverseSpeed: 8,

  wallRestitution: 0.3,
  wallFriction: 0.5,
  damageThreshold: 3,
  crashSpeed: 20,
  damagePerSpeed: 0.03,
  maxDamage: 0.8,
};
