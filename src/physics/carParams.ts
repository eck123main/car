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
  /** Slide angle (share of `peakSlip`) the caster ignores: a car cornering normally runs a little sideways, and following that made it flick back when the keys were let go. */
  alignFrom: number;
  /**
   * Stability, in the steering: the front tyres turn the car at most this share of what the rear
   * can follow. At 1 the rear is never asked past its peak: with a light rear (hard on the brakes,
   * rear wheels on a kerb or the grass) the car pushes wide instead of swapping ends.
   */
  balance: number;
  /** Rear slip (share of `peakSlip`) from where the steering starts catching a slide, and how hard. */
  catchFrom: number;
  catchGain: number;
  /** Share of `mu` the front axle really gives in a steady corner: what bots and the ideal line plan with. */
  planGrip: number;
  /**
   * Bot pace (share of grip planned) for Easy / Medium / Hard in this car. Tyre-model cars stop getting
   * faster near the limit, so the F1's 0.74 / 0.86 / 0.95 left Medium and Hard level: these put Easy
   * ~10% and Medium ~4% off Hard, like the F1 (`npx tsx scripts/bot-skill.ts`).
   */
  botPace: [number, number, number];
  /** Grass and gravel's drag on this car, against the F1's (it has far less traction to pull through them). */
  surfaceDrag: number;
  /** Road speed at the rev limit in each gear (m/s). */
  gears: number[];
  /**
   * Wheelspin: the driven wheels' and engine's inertia as a mass at the tread (kg), the spin
   * (m/s) where the tyre is well past its best, and how much sideways grip a spinning rear loses.
   */
  wheelMass: number;
  spinPeak: number;
  spinLateral: number;
  /** Traction control: the wheelspin (m/s) it allows off / low / high, each ignition cut (s), and the power left during one. */
  tcSlip: [number, number, number];
  tcCutTime: number;
  tcCutPower: number;
  /** During a cut, the drive is also held to this share of what the spinning tyres give, so they hook up. */
  tcHookUp: number;
  /** Upshift: seconds with no drive. */
  shiftTime: number;
  /** Engine braking on the rear axle at high revs (N). */
  engineBrake: number;
  /**
   * A handbrake (the drift car, on Space): pulled, it locks the rear wheels, and a locked tyre keeps
   * only this share of its sideways grip, so the tail swings out. Missing: no handbrake.
   */
  handbrake?: number;
  /** Stability assist: how early (s) the steering unwinds as a slide straightens, so it doesn't snap the other way. Missing: 0. */
  unwind?: number;
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
 * downforce at 250 km/h (the game gives it more grip and downforce, see `mu` and `downforceCoef`). Driven by the full tyre model, with the ABS and traction control the
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

  // A real GT3's slicks hold ~1.55 g; the game's is 20% grippier (game feel: next to the F1 and on
  // half-scale tracks, the real figure felt like a car that won't turn).
  mu: 1.86,

  power: 365_000,
  maxDriveForce: 10_500,
  combinedGripPenalty: 0.55,
  brakeGrip: 0.95,

  dragCoef: 0.64,
  // A real GT3 makes ~600 kg of downforce at 250 km/h (1.2 here); the game's makes twice that: on
  // half-scale tracks fast corners are twice as tight, and at the real figure players found it
  // would hardly turn at speed. ~3 g at 250 km/h, still well short of the F1's 6-7 g.
  downforceCoef: 2.4,
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
    rearGrip: 1.06,
    loadSensitivity: 0.06,
    rearBrake: 0.7,
    maxSteer: 0.38,
    steerSlip: 0.45,
    selfAlign: 0.7,
    alignFrom: 0.4,
    balance: 1.15,
    catchFrom: 1.1,
    catchGain: 2,
    planGrip: 0.96,
    botPace: [0.66, 0.81, 0.95],
    surfaceDrag: 0.55,
    // A six-speed sequential: 100 / 140 / 180 / 220 / 260 / 310 km/h at the limiter.
    gears: [27.8, 38.9, 50, 61.1, 72.2, 86.1],
    shiftTime: 0.05,
    wheelMass: 60,
    spinPeak: 2,
    spinLateral: 0.3,
    tcSlip: [Infinity, 0.8, 0.2],
    tcCutTime: 0.04,
    tcCutPower: 0.85,
    tcHookUp: 0.92,
    engineBrake: 1600,
  },
};

/**
 * A Le Mans Hypercar (Toyota GR010, Ferrari 499P, Porsche 963 and friends), on real figures:
 * 1030 kg, ~400 kW from the engine plus a front-axle hybrid (the class's ERS, only above
 * 190 km/h as the real rules allow), about 340 km/h flat out. Far more downforce than a GT3 and
 * less than the F1; given the same extra grip over the real tyres as the GT3 (game feel on
 * half-scale tracks). Driven by the full tyre model like the GT3, with ABS and traction control.
 */
export const HYPERCAR_CAR: CarParams = {
  mass: 1030,
  // A 3.15 m wheelbase, ~48% of the weight on the front.
  cgToFront: 1.65,
  cgToRear: 1.5,
  length: 5.0,
  width: 2.0,
  inertia: 1900,

  mu: 2.1,

  power: 400_000,
  maxDriveForce: 11_500,
  combinedGripPenalty: 0.55,
  brakeGrip: 0.95,

  dragCoef: 0.6,
  downforceCoef: 3.4,
  aeroBalanceFront: 0.42,
  rollingResistance: 0.015,

  minTurnRadius: 7,
  turnGripUse: 1,
  yawResponse: 7,
  steerRate: 6.5,
  steerReturnRate: 9.5,
  wheelAngleVisual: 0.36,
  throttleRate: 6,
  brakeRate: 7.5,

  reverseForce: 6000,
  maxReverseSpeed: 8,

  wallRestitution: 0.25,
  wallFriction: 0.5,
  damageThreshold: 4,
  crashSpeed: 27,
  damagePerSpeed: 0.022,
  maxDamage: 0.8,

  dynamics: {
    ...GT3_CAR.dynamics!,
    cgHeight: 0.34,
    peakSlip: 0.1,
    surfaceDrag: 0.65,
    botPace: [0.7, 0.84, 1.0],
    // A seven-speed sequential: 100 / 140 / 180 / 220 / 260 / 300 / 345 km/h at the limiter.
    gears: [27.8, 38.9, 50, 61.1, 72.2, 83.3, 95.8],
    wheelMass: 50,
    engineBrake: 1400,
  },
};

/**
 * A pro drift car (Formula Drift style): a widebody coupe with ~600 kW, a huge steering lock and
 * not much downforce. The rear lets go on the power, the lift or the handbrake (Space), and the
 * stability assist (on by default) lets it slide to big angles, catching it only near a spin;
 * the front wheels follow the slide on their own, which is the counter-steer. Not quick: sliding
 * is slower than gripping, as in real life.
 */
export const DRIFT_CAR: CarParams = {
  mass: 1250,
  // Near 50/50, a short wheelbase: it rotates easily.
  cgToFront: 1.35,
  cgToRear: 1.3,
  length: 4.6,
  width: 2.0,
  inertia: 1900,

  mu: 1.65,

  power: 600_000,
  maxDriveForce: 13_000,
  combinedGripPenalty: 0.55,
  brakeGrip: 0.95,

  dragCoef: 0.72,
  downforceCoef: 0.8,
  aeroBalanceFront: 0.45,
  rollingResistance: 0.015,

  minTurnRadius: 5,
  turnGripUse: 1,
  yawResponse: 6.5,
  steerRate: 6,
  steerReturnRate: 9,
  wheelAngleVisual: 0.6,
  throttleRate: 7,
  brakeRate: 7,

  reverseForce: 6000,
  maxReverseSpeed: 8,

  wallRestitution: 0.25,
  wallFriction: 0.5,
  damageThreshold: 4,
  crashSpeed: 27,
  damagePerSpeed: 0.02,
  maxDamage: 0.8,

  dynamics: {
    ...GT3_CAR.dynamics!,
    cgHeight: 0.45,
    peakSlip: 0.13,
    slideGrip: 0.85,
    rearGrip: 1.05,
    maxSteer: 0.95,
    steerSlip: 0.5,
    selfAlign: 0.9,
    balance: 1.6,
    // With the steering held into the corner, the assist lets the rear slide to ~35 degrees before
    // it catches it (less as the keys let go, see `Car.catchAt`), and unwinds early as it straightens.
    catchFrom: 4.5,
    catchGain: 2.5,
    unwind: 0.08,
    // Bots plan for less: the rear lets go on the power (tested on every track, `driftCar.test.ts`).
    planGrip: 0.75,
    botPace: [0.68, 0.8, 0.95],
    surfaceDrag: 0.6,
    // A five-speed: 90 / 130 / 170 / 215 / 265 km/h at the limiter.
    gears: [25, 36, 47.2, 59.7, 73.6],
    spinPeak: 2.5,
    spinLateral: 0.45,
    // Traction control: high is for grip (bots, lap times), low lets it slide on the power, off is a full drift.
    tcSlip: [Infinity, 3, 0.8],
    // Its cuts go deeper than the GT3's: with 600 kW, 85% of the power still spins the tyres.
    tcCutPower: 0.5,
    tcHookUp: 0.8,
    engineBrake: 2200,
    handbrake: 0.3,
  },
};
