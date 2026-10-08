/** Tunable car parameters. SI units (kg, m, s, N, W) unless noted. */
export interface CarParams {
  mass: number;
  cgToFront: number;
  cgToRear: number;
  length: number;
  width: number;
  /** Yaw moment of inertia (kg m^2), used for wall impacts. */
  inertia: number;

  /** Peak tyre friction coefficient on dry asphalt. */
  mu: number;

  power: number;
  /** Caps drive force at low speed. */
  maxDriveForce: number;
  /** How much braking/accelerating reduces cornering grip (1 = full friction circle, 0 = none). */
  combinedGripPenalty: number;
  /** Fraction of the asphalt grip limit the brakes can use. */
  brakeGrip: number;

  /** Drag force = dragCoef * v^2. */
  dragCoef: number;
  /** Downforce = downforceCoef * v^2. */
  downforceCoef: number;
  aeroBalanceFront: number;
  rollingResistance: number;

  /** Tightest turn at low speed (m). */
  minTurnRadius: number;
  /** Share of the available grip that full steering uses (1 = right at the limit). */
  turnGripUse: number;
  /** How quickly the car's rotation follows the steering (1/s). */
  yawResponse: number;
  /** How quickly steering input ramps in and centres (full range per second). */
  steerRate: number;
  steerReturnRate: number;
  /** Max front wheel angle, only used for drawing (rad). */
  wheelAngleVisual: number;
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
  cgToFront: 1.95,
  cgToRear: 1.65,
  length: 5.6,
  width: 1.9,
  inertia: 1100,

  mu: 2.4,

  power: 740_000,
  maxDriveForce: 14_000,
  combinedGripPenalty: 0.5,
  brakeGrip: 0.85,

  dragCoef: 0.85,
  downforceCoef: 2.4,
  aeroBalanceFront: 0.42,
  rollingResistance: 0.015,

  minTurnRadius: 9,
  turnGripUse: 1,
  yawResponse: 8,
  steerRate: 7,
  steerReturnRate: 10,
  wheelAngleVisual: 0.35,
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
