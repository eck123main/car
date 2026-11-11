/**
 * A full two-axle tyre model instead of the simple grip model: slip angles, weight transfer,
 * ABS, traction control and a gearbox. The car can rotate on a lift, push wide on the brakes and
 * step out on the power. See `Car.tyreStep`.
 */
export interface TyreDynamics {
  /** Height of the centre of gravity (m): how much weight moves under braking and acceleration. */
  cgHeight: number;
  /** Slip angle where a tyre gives its most (rad). */
  peakSlip: number;
  /** Share of the peak force a tyre keeps once it is sliding well past it. */
  slideGrip: number;
  /** Rear axle's grip against the front's (wider tyres). */
  rearGrip: number;
  /** How much less grip per kg a tyre has at twice its normal load. */
  loadSensitivity: number;
  /** Share of the rear axle's grip the brakes use (ABS holds the rear back, for stability). */
  rearBrake: number;
  /** Max front wheel angle (rad). */
  maxSteer: number;
  /** How much slip the steering adds at full lock, as a share of `peakSlip`. */
  steerSlip: number;
  /** How far the front wheels follow a slide on their own (the caster's self-aligning). */
  selfAlign: number;
  /** Share of `mu` the front axle really gives in a steady corner: what bots and the ideal line plan with. */
  planGrip: number;
  /** Road speed at the rev limit in each gear (m/s). */
  gears: number[];
  /** Upshift: seconds with no drive. */
  shiftTime: number;
  /** Engine braking on the rear axle at high revs (N). */
  engineBrake: number;
}

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
  /** The full tyre model; without it, the simple grip model. */
  dynamics?: TyreDynamics;
}

/** Roughly modelled on a modern F1 car. */
export const F1_CAR: CarParams = {
  mass: 800,
  cgToFront: 1.95,
  cgToRear: 1.65,
  length: 5.6,
  width: 1.9,
  inertia: 1100,

  mu: 2.7,

  power: 740_000,
  maxDriveForce: 14_000,
  combinedGripPenalty: 0.5,
  brakeGrip: 0.95,

  dragCoef: 1.1,
  downforceCoef: 2.4,
  aeroBalanceFront: 0.42,
  rollingResistance: 0.015,

  minTurnRadius: 7.5,
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
  crashSpeed: 25,
  damagePerSpeed: 0.025,
  maxDamage: 0.8,
};

/**
 * A GT3 car (911 GT3 R, M4 GT3, 296 GT3 and friends), on real figures: about 1300 kg with the
 * driver, 365 kW at the wheels, slicks with ~1.55 g of mechanical grip, and an estimated 600 kg of
 * downforce at 250 km/h. Driven by the full tyre model, with the ABS and traction control the
 * real cars have. Checked against real performance in `gt3Physics.test.ts`.
 */
export const GT3_CAR: CarParams = {
  mass: 1300,
  // ~46% of the weight on the front axle.
  cgToFront: 1.45,
  cgToRear: 1.25,
  length: 4.6,
  width: 2.0,
  inertia: 2400,

  mu: 1.55,

  power: 365_000,
  maxDriveForce: 10_500,
  combinedGripPenalty: 0.55,
  brakeGrip: 0.95,

  dragCoef: 0.64,
  downforceCoef: 1.2,
  aeroBalanceFront: 0.4,
  rollingResistance: 0.015,

  minTurnRadius: 6.5,
  turnGripUse: 1,
  yawResponse: 6.5,
  steerRate: 6,
  steerReturnRate: 9,
  wheelAngleVisual: 0.38,
  throttleRate: 6,
  brakeRate: 7,

  reverseForce: 6000,
  maxReverseSpeed: 8,

  wallRestitution: 0.25,
  wallFriction: 0.5,
  damageThreshold: 4,
  crashSpeed: 28,
  damagePerSpeed: 0.02,
  maxDamage: 0.8,

  dynamics: {
    cgHeight: 0.42,
    peakSlip: 0.11,
    slideGrip: 0.9,
    rearGrip: 1.12,
    loadSensitivity: 0.06,
    rearBrake: 0.7,
    maxSteer: 0.38,
    steerSlip: 0.45,
    selfAlign: 0.85,
    planGrip: 0.97,
    // A six-speed sequential: 100 / 140 / 180 / 220 / 260 / 310 km/h at the limiter.
    gears: [27.8, 38.9, 50, 61.1, 72.2, 86.1],
    shiftTime: 0.05,
    engineBrake: 1600,
  },
};
