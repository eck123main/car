import { Car, type CarWorld, type DriverInput } from '../../physics/car';
import { CAR_CLASSES, type CarClassId } from '../carClass';
import type { Slope, WallContact } from '../../track/track';
import { SURFACES, type Surface } from '../../track/types';
import type { PlayerInput } from '../world';
import { openRoadMap, type OpenRoadMap } from './biomes';
import { Land } from './land';
import { MAX_PLANT_RADIUS, MAX_SOLID_RADIUS, SolidPlants } from './plants';
import { type EndlessRoad, FENCE_LEFT, FENCE_OFFSET, FENCE_RIGHT, ROAD_HALF, ROAD_SPACING, SHOULDER } from './road';

/** As in the race world: ERS power, its battery (s) and DRS's cut in drag. */
const ERS_POWER = 120_000;
const ERS_DEPLOY_TIME = 7;
const DRS_DRAG = 0.65;
/** The battery fills a little quicker than in a race: nobody is counting. */
const ERS_TRICKLE = 0.04;
/** Off the road: drivable, slow, and no walls to catch you. */
const SHOULDER_SURFACE: Surface = { type: 'kerb', grip: 0.92, drag: 0.25, dragPerSpeed: 0 };
const OFF_ROAD: Surface = { type: 'grass', grip: 0.72, drag: 1.2, dragPerSpeed: 0.24 };
const IN_WATER: Surface = { type: 'gravel', grip: 0.3, drag: 7, dragPerSpeed: 1.2 };
/** Under water this long and you're put back on the road (s). */
const WATER_RESET = 1.2;
/** Hitting a tree or rock faster than this along the hit is a crash (m/s, ~32 km/h); slower just bumps. */
const CRASH_FROM = 9;
/** A fence gives more than a tree: only a hard hit is a crash (m/s along the hit, ~60 km/h). */
const FENCE_CRASH_FROM = 17;
/** Scrapes softer than this do no damage (m/s). */
const SCRAPE = 4;
/** The car's half width against a fence (m). */
const CAR_SIDE = 0.95;
/** Buildings are further from the road's centre than this (m): nearer, only plants are looked for. */
const BUILDINGS_FROM = 60;
/** How long the crash plays before you're back on the road (s). */
export const CRASH_TIME = 1.4;
/** After a crash you restart this far back along the road from where you were (m). */
const RESTART_BACK = 40;
/** Circles along the car (m from its centre) and their radius (m). */
const CAR_CIRCLES = [-2, 0, 2];
const CAR_RADIUS = 0.9;
/** A small hit sends the car back off this fraction of its speed into the plant. */
const BUMP_BOUNCE = 0.3;
/**
 * Steering at speed: how quickly a key press takes effect (full range per second; slower feeds a weave) and how much of
 * the car's possible turn it asks for. Tapping for a long bend shouldn't twitch; slow down and
 * it's all there. Only the input changes: the car is the race car.
 */
const CALM_STEER_RATE = 10;
const CALM_STEER_SHARE = 0.2;
/** A GT3 has far less grip to soften: much the same turn at full lock as the F1 at top speed. */
const GT_CALM_STEER_SHARE = 0.85;
const CALM_FROM = 25;
const CALM_TO = 85;

function calmShare(v: number): number {
  return Math.max(0, Math.min(1, (v - CALM_FROM) / (CALM_TO - CALM_FROM)));
}

/**
 * Driving on the open road: the real car (same physics, power, grip and DRS/ERS numbers as a race),
 * alone on an endless road with no timing. Trees, rocks, buildings and fences are solid.
 */
export class OpenRoadDrive implements CarWorld {
  readonly car: Car;
  readonly land: Land;
  readonly road: EndlessRoad;
  readonly map: OpenRoadMap;
  time = 0;
  /** Metres driven (the odometer). */
  distance = 0;
  ers = 1;
  ersActive = false;
  drsOpen = false;
  /** Height of the ground under the car (m). */
  groundZ = 0;
  /** Set for one step when the water put the car back on the road. */
  rescued = false;
  /** Why: the water or a crash. */
  rescuedBy: 'water' | 'crash' = 'water';
  /** Seconds left of a crash playing out; 0 when driving. */
  crashing = 0;
  /** Crashes this drive. */
  crashes = 0;
  readonly plants: SolidPlants;
  private readonly slopeNow: Slope = { grade: 0, vcurv: 0, tx: 1, ty: 0 };
  private steerIn = 0;
  private underWater = 0;
  /** Where the car was across the road last step (m): a fence only stops a car coming from the road's side. */
  private lastLateral = 0;
  private readonly grad = { gx: 0, gy: 0 };
  /** Nothing solid stands closer to the road's edge than this on this map (m). */
  private readonly clearFrom: number;

  constructor(
    mapId: string,
    seed: number,
    readonly carClass: CarClassId = 'f1',
  ) {
    this.car = new Car(CAR_CLASSES[carClass].params, '#e10600');
    this.map = openRoadMap(mapId);
    this.land = new Land(seed, this.map);
    this.road = this.land.road;
    this.plants = new SolidPlants(this.land);
    this.clearFrom = Math.min(...this.map.biomes.map((b) => b.flora.clear));
    this.backOnRoad(this.road.startIndex);
  }

  /** On the road, stopped, repaired, nose along it. */
  backOnRoad(index = this.road.nearest(this.car.x, this.car.y)): void {
    const r = this.road;
    this.car.place(r.x[index], r.y[index], Math.atan2(r.ty[index], r.tx[index]), index);
    this.car.repair();
    this.steerIn = 0;
    this.underWater = 0;
    this.crashing = 0;
    this.lastLateral = 0;
    this.drsOpen = this.ersActive = false;
    this.groundZ = r.z[index];
  }

  surfaceAt(x: number, y: number, hint: number | null = null): Surface {
    const r = this.road;
    const d = Math.abs(r.lateral(r.nearest(x, y, hint), x, y));
    if (d <= ROAD_HALF) return SURFACES.asphalt;
    if (d <= ROAD_HALF + SHOULDER) return SHOULDER_SURFACE;
    return this.underWater > 0 ? IN_WATER : OFF_ROAD;
  }

  wallContact(): WallContact | null {
    return null;
  }

  locate(x: number, y: number, hint: number | null = null): number | null {
    return this.road.nearest(x, y, hint);
  }

  slope(): Slope {
    return this.slopeNow;
  }

  /** What the ground is doing under the car, for this step. */
  private readGround(): void {
    const { car, road, land } = this;
    const i = road.nearest(car.x, car.y, car.trackIndex);
    const s = this.slopeNow;
    this.groundZ = land.driveHeight(car.x, car.y, i);
    if (Math.abs(road.lateral(i, car.x, car.y)) <= ROAD_HALF + SHOULDER) {
      s.grade = road.grade[i];
      s.vcurv = road.vcurv[i];
      s.tx = road.tx[i];
      s.ty = road.ty[i];
      return;
    }
    land.gradient(car.x, car.y, this.grad);
    const { gx, gy } = this.grad;
    const g = Math.hypot(gx, gy);
    s.grade = g;
    s.vcurv = 0;
    s.tx = g > 1e-6 ? gx / g : 1;
    s.ty = g > 1e-6 ? gy / g : 0;
  }

  /**
   * Trunks and rocks. Only looked for off the road, where they stand (working out a tile takes a
   * moment, and a drive on the road never needs one).
   */
  private hitPlants(): void {
    const { car } = this;
    const carReach = CAR_CIRCLES[CAR_CIRCLES.length - 1] + CAR_RADIUS;
    const offset = Math.abs(this.roadOffset());
    if (offset < ROAD_HALF + SHOULDER + this.clearFrom - carReach - MAX_PLANT_RADIUS) return;
    const reach = carReach + (offset < BUILDINGS_FROM ? MAX_PLANT_RADIUS : MAX_SOLID_RADIUS);
    const c = Math.cos(car.heading);
    const s = Math.sin(car.heading);
    this.plants.near(car.x, car.y, reach, (p) => {
      if (this.crashing > 0) return;
      if (Math.abs(p.x - car.x) > reach || Math.abs(p.y - car.y) > reach) return;
      for (const along of CAR_CIRCLES) {
        const dx = car.x + c * along - p.x;
        const dy = car.y + s * along - p.y;
        const min = p.radius + CAR_RADIUS;
        const d2 = dx * dx + dy * dy;
        if (d2 >= min * min) continue;
        const d = Math.max(1e-3, Math.sqrt(d2));
        this.hit(dx / d, dy / d, min - d, along, CRASH_FROM);
        return;
      }
    });
  }

  /** The car met a plant: nx, ny points from the plant to the car, overlap in metres. */
  private hit(nx: number, ny: number, overlap: number, along: number, crashFrom: number): void {
    const { car } = this;
    car.x += nx * overlap;
    car.y += ny * overlap;
    const into = -(car.vx * nx + car.vy * ny);
    if (into <= 0) return;
    const c = Math.cos(car.heading);
    const s = Math.sin(car.heading);
    // Where it landed, in the car's own frame (x forward, y right).
    const forward = along + Math.max(-1, Math.min(1, -nx * c - ny * s));
    const right = nx * s - ny * c;
    if (into > SCRAPE) car.impact(into, forward, right, 'wall');
    if (into > crashFrom) {
      car.vx = car.vy = car.yawRate = 0;
      this.crashing = CRASH_TIME;
      this.crashes++;
      this.drsOpen = this.ersActive = false;
      return;
    }
    const k = into * (1 + BUMP_BOUNCE);
    car.vx += nx * k;
    car.vy += ny * k;
  }

  /** The fences along the road: they hold a car in, and it slides along them unless it hit hard. */
  private hitFences(): void {
    const { car, road } = this;
    const i = road.nearest(car.x, car.y, car.trackIndex);
    const lat = road.lateral(i, car.x, car.y);
    const limit = FENCE_OFFSET - CAR_SIDE;
    const before = this.lastLateral;
    this.lastLateral = lat;
    if (Math.abs(lat) <= limit || this.crashing > 0) return;
    // Already outside (round the end of one, or off a different stretch): it doesn't stop you.
    if (Math.abs(before) > limit + 0.01 || before * lat < 0) return;
    if ((road.fence[i] & (lat > 0 ? FENCE_RIGHT : FENCE_LEFT)) === 0) return;
    const side = lat > 0 ? 1 : -1;
    this.hit(road.ty[i] * side, -road.tx[i] * side, Math.abs(lat) - limit, 0, FENCE_CRASH_FROM);
    this.lastLateral = side * limit;
  }

  /** On the road near where the car is, a little way back so there's room to get going. */
  private restartAfterCrash(): void {
    const i = this.road.nearest(this.car.x, this.car.y, this.car.trackIndex);
    this.backOnRoad(Math.max(0, i - Math.round(RESTART_BACK / ROAD_SPACING)));
    this.rescued = true;
    this.rescuedBy = 'crash';
  }

  private calmSteer(steer: number, dt: number): number {
    const k = calmShare(this.car.speed);
    const d = (12 + (CALM_STEER_RATE - 12) * k) * dt;
    this.steerIn += Math.max(-d, Math.min(d, steer - this.steerIn));
    return this.steerIn * (1 + ((this.carClass === 'gt3' ? GT_CALM_STEER_SHARE : CALM_STEER_SHARE) - 1) * k);
  }

  step(dt: number, input: PlayerInput): void {
    const { car } = this;
    this.time += dt;
    this.rescued = false;
    this.readGround();
    if (this.crashing > 0) {
      this.crashing -= dt;
      if (this.crashing <= 0) {
        this.restartAfterCrash();
        return;
      }
      car.gripFactor = 1;
      car.dragFactor = 1;
      car.extraPower = 0;
      car.step({ throttle: 0, brake: 1, steer: 0 }, dt, this);
      return;
    }
    if (this.groundZ < -0.2) {
      this.underWater += dt;
      if (this.underWater > WATER_RESET) {
        this.backOnRoad();
        this.rescued = true;
        this.rescuedBy = 'water';
        return;
      }
    } else this.underWater = 0;

    this.ersActive = CAR_CLASSES[this.carClass].ers && input.ers && this.ers > 0 && car.throttle > 0.5;
    if (this.ersActive) this.ers = Math.max(0, this.ers - dt / ERS_DEPLOY_TIME);
    else this.ers = Math.min(1, this.ers + dt * (0.25 * car.brake + ERS_TRICKLE));
    if (input.drs && CAR_CLASSES[this.carClass].drs) this.drsOpen = true;
    if (car.brake > 0.05 || car.speed < 15) this.drsOpen = false;

    car.gripFactor = 1;
    car.dragFactor = this.drsOpen ? DRS_DRAG : 1;
    car.extraPower = this.ersActive ? ERS_POWER : 0;
    const x0 = car.x;
    const y0 = car.y;
    const driver: DriverInput = { throttle: input.throttle, brake: input.brake, steer: this.calmSteer(input.steer, dt) };
    car.step(driver, dt, this);
    this.distance += Math.hypot(car.x - x0, car.y - y0);
    this.hitFences();
    this.hitPlants();
  }

  /** Where the car is on the road (m to the right of the centre). */
  roadOffset(): number {
    const r = this.road;
    return r.lateral(r.nearest(this.car.x, this.car.y, this.car.trackIndex), this.car.x, this.car.y);
  }
}

/** How far ahead (samples) the autopilot checks for corners. */
const PILOT_SCAN = 150;
const PILOT_BRAKING = 16;
/** A GT3 has about this share of the F1 car's grip, for the autopilot's plans. */
const GT_PILOT_GRIP = 0.45;
const GT_PILOT_BRAKING = 7;

/**
 * Hands off: follows the middle of its lane at a calm pace. Also what the tests drive with,
 * to prove the road can always be driven.
 */
export class RoadPilot {
  /** Speed it settles at (m/s). */
  cruise = 55;
  /** Metres right of the road's centre. */
  lane = 3.4;
  /** Sideways g it will take in a corner. */
  cornering = 2.2;
  private readonly braking: number;
  private readonly gt: boolean;

  constructor(
    private readonly road: EndlessRoad,
    carClass: CarClassId = 'f1',
  ) {
    const gt = (this.gt = carClass === 'gt3');
    this.braking = gt ? GT_PILOT_BRAKING : PILOT_BRAKING;
    if (gt) this.cornering *= GT_PILOT_GRIP;
  }

  /** Steering here is what's given to OpenRoadDrive.step (before its softening). */
  drive(car: Car): DriverInput {
    const r = this.road;
    const v = car.speed;
    const i = r.nearest(car.x, car.y, car.trackIndex);
    r.ensure(r.x[i] + 1200);
    const look = Math.max(14, v * 0.75);
    const k = Math.min(r.count - 1, i + Math.ceil(look / ROAD_SPACING));
    // Aim for the lane, a little ahead.
    const dx = r.x[k] - r.ty[k] * this.lane - car.x;
    const dy = r.y[k] + r.tx[k] * this.lane - car.y;
    const dist = Math.max(1, Math.hypot(dx, dy));
    const err = Math.atan2(dy, dx) - car.heading;
    const off = Math.atan2(Math.sin(err), Math.cos(err));
    const curvature = (2 * Math.sin(off)) / dist;
    // Full lock's turn at this speed, as the car works it out, softened as in OpenRoadDrive.
    const p = car.params;
    const accel = p.mu * (9.81 + (p.downforceCoef * v * v) / p.mass);
    const yawLimit = Math.min(v / p.minTurnRadius, accel / Math.max(v, 1));
    const share = 1 + ((this.gt ? GT_CALM_STEER_SHARE : CALM_STEER_SHARE) - 1) * calmShare(v);
    const steer = Math.max(-1, Math.min(1, (curvature * Math.max(v, 3)) / Math.max(0.05, yawLimit) / share));
    // Slow enough for everything inside braking distance.
    const grip = this.cornering * 9.81;
    let allowed = this.cruise;
    const end = Math.min(r.count - 1, i + PILOT_SCAN);
    for (let j = i; j < end; j++) {
      const c = Math.abs(r.kappa[j]);
      if (c < 1e-4) continue;
      const corner = Math.sqrt(grip / c);
      allowed = Math.min(allowed, Math.sqrt(corner * corner + 2 * this.braking * (j - i) * ROAD_SPACING));
    }
    const gap = allowed - v;
    return { throttle: gap > 0.5 ? Math.min(1, gap / 8) : 0, brake: gap < -2 ? Math.min(1, -gap / 12) : 0, steer };
  }
}
