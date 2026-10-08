import { LapTimer, type TimingEvent } from '../game/lapTimer';
import { Car, type DriverInput } from '../physics/car';
import { F1_CAR } from '../physics/carParams';
import type { Track } from '../track/track';
import { type Compound, Tyres } from './tyres';

/** Everything a player controls. Sent over the network as state, not key events. */
export interface PlayerInput extends DriverInput {
  /** Hold to open DRS (only works where it's allowed). */
  drs: boolean;
  /** Hold to deploy ERS. */
  ers: boolean;
  /** Pit limiter switch. */
  limiter: boolean;
  /** Tyres to fit at the next pit stop. */
  nextTyre: Compound;
}

export const IDLE_INPUT: PlayerInput = {
  throttle: 0,
  brake: 0,
  steer: 0,
  drs: false,
  ers: false,
  limiter: false,
  nextTyre: 'medium',
};

export const PIT_SPEED_LIMIT = 80 / 3.6;
/** ERS: extra power while deploying, seconds of deployment in a full battery. */
const ERS_POWER = 120_000;
const ERS_DEPLOY_TIME = 7;
const DRS_DRAG = 0.72;
const DRS_GAP = 1;
const SLIPSTREAM_RANGE = 45;
const SLIPSTREAM_MAX = 0.35;

export interface Racer {
  id: string;
  name: string;
  color: string;
  car: Car;
  timer: LapTimer;
  tyres: Tyres;
  input: PlayerInput;
  /** ERS battery 0..1. */
  ers: number;
  ersActive: boolean;
  drsOpen: boolean;
  /** DRS may be opened in the current zone (or the next one, once detected). */
  drsEligible: boolean;
  /** 0..1 how much tow this car is getting. */
  slipstream: number;
  /** Per DRS zone: has this car earned DRS for it? */
  drsZoneEligible: boolean[];
}

export interface WorldOptions {
  /** 'free': DRS usable in every zone (practice/qualifying). 'race': within 1 s at detection, from lap 2. */
  drsRule: 'free' | 'race';
  /** 0 = dry, 1 = soaked. */
  wetness: number;
}

export type WorldEvent = TimingEvent & { racerId: string };

/**
 * The shared race simulation: every car, its tyres, ERS, DRS and timing.
 * The host runs this; clients only display its state.
 */
export class RaceWorld {
  time = 0;
  readonly racers: Racer[] = [];
  /** Last time any car crossed each DRS detection line, and which car. */
  private readonly detections: { time: number; id: string }[];

  constructor(
    readonly track: Track,
    readonly options: WorldOptions,
  ) {
    this.detections = track.drsZones.map(() => ({ time: -Infinity, id: '' }));
  }

  addRacer(id: string, name: string, color: string, compound: Compound = 'medium'): Racer {
    const racer: Racer = {
      id,
      name,
      color,
      car: new Car(F1_CAR, color),
      timer: new LapTimer(this.track),
      tyres: new Tyres(compound),
      input: { ...IDLE_INPUT, nextTyre: compound },
      ers: 1,
      ersActive: false,
      drsOpen: false,
      drsEligible: false,
      slipstream: 0,
      drsZoneEligible: this.track.drsZones.map(() => false),
    };
    this.racers.push(racer);
    return racer;
  }

  racer(id: string): Racer | undefined {
    return this.racers.find((r) => r.id === id);
  }

  step(dt: number, inputs: ReadonlyMap<string, PlayerInput>): WorldEvent[] {
    this.time += dt;
    const events: WorldEvent[] = [];
    this.updateSlipstream();
    for (const r of this.racers) {
      r.input = inputs.get(r.id) ?? r.input;
      this.stepRacer(r, dt, events);
    }
    return events;
  }

  private stepRacer(r: Racer, dt: number, events: WorldEvent[]): void {
    const { car, input } = r;
    const prevS = r.timer.lapDistance;

    // ERS: deploy on the throttle while the button is held; harvest under braking.
    r.ersActive = input.ers && r.ers > 0 && car.throttle > 0.5 && !car.retired;
    if (r.ersActive) r.ers = Math.max(0, r.ers - dt / ERS_DEPLOY_TIME);
    else r.ers = Math.min(1, r.ers + dt * (0.25 * car.brake + 0.01));

    car.gripFactor = r.tyres.grip(this.options.wetness);
    car.dragFactor = (r.drsOpen ? DRS_DRAG : 1) * (1 - SLIPSTREAM_MAX * r.slipstream);
    car.extraPower = r.ersActive ? ERS_POWER : 0;
    car.speedLimit = input.limiter ? PIT_SPEED_LIMIT : null;

    const x0 = car.x;
    const y0 = car.y;
    car.step(input, dt, this.track);
    r.tyres.update(Math.hypot(car.x - x0, car.y - y0), this.track.length, this.options.wetness);

    for (const e of r.timer.update(this.time, dt, car)) events.push({ ...e, racerId: r.id });
    this.updateDrs(r, prevS);
  }

  private updateDrs(r: Racer, prevS: number | null): void {
    const s = r.timer.lapDistance;
    const zones = this.track.drsZones;
    const eligible = r.drsZoneEligible;
    const wet = this.options.wetness >= 0.3;
    let inZone = false;
    let canOpen = false;
    zones.forEach((zone, i) => {
      if (s === null) return;
      if (prevS !== null && crossed(this.track, prevS, s, zone.detect)) {
        const last = this.detections[i];
        // Race rule: within a second of the car ahead at the detection line, from lap 2.
        eligible[i] =
          !wet &&
          (this.options.drsRule === 'free' ||
            (r.timer.lapsCompleted >= 1 && last.id !== r.id && this.time - last.time < DRS_GAP));
        this.detections[i] = { time: this.time, id: r.id };
      }
      if (this.track.inRange(s, zone.start, zone.end)) {
        inZone = true;
        if (this.options.drsRule === 'free' && !wet) eligible[i] = true;
        if (eligible[i]) canOpen = true;
      } else if (prevS !== null && crossed(this.track, prevS, s, zone.end)) {
        eligible[i] = false;
      }
    });
    r.drsEligible = canOpen || eligible.some((e) => e);
    // DRS closes as soon as the driver brakes.
    r.drsOpen = inZone && canOpen && r.input.drs && r.car.brake < 0.05 && !r.car.retired;
  }

  /** A car gets a tow when it's right behind another car going the same way. */
  private updateSlipstream(): void {
    for (const a of this.racers) {
      a.slipstream = 0;
      const ca = a.car;
      const fx = Math.cos(ca.heading);
      const fy = Math.sin(ca.heading);
      for (const b of this.racers) {
        if (b === a || b.car.retired) continue;
        const dx = b.car.x - ca.x;
        const dy = b.car.y - ca.y;
        const ahead = dx * fx + dy * fy;
        const side = Math.abs(-dx * fy + dy * fx);
        const sameWay = Math.cos(b.car.heading - ca.heading) > 0.9;
        if (ahead > 4 && ahead < SLIPSTREAM_RANGE && side < 3 && sameWay) {
          a.slipstream = Math.max(a.slipstream, 1 - ahead / SLIPSTREAM_RANGE);
        }
      }
    }
  }
}

/** Did the car pass lap distance `line` going forwards between prevS and s? */
function crossed(track: Track, prevS: number, s: number, line: number): boolean {
  const moved = track.forwardDistance(prevS, s);
  if (moved === 0 || moved > 30) return false;
  const toLine = track.forwardDistance(prevS, line);
  return toLine > 0 && toLine <= moved;
}
