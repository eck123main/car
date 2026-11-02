import * as THREE from 'three';
import type { SurfaceType } from '../track/types';
import { Particles3d } from './particles3d';

/**
 * What the tyres leave behind (looks only): smoke when they lock up, spin or slide, rubber laid
 * on the road that builds up over a race, dust and stones when a car runs off, and a faint
 * shimmer of hot air from the exhaust. The physics has no real lockups or wheelspin (grip just
 * limits the force), so these are read from what the driver is doing with the car.
 */

/** One car this frame. */
export interface TyreCar {
  x: number;
  y: number;
  heading: number;
  speed: number;
  brake: number;
  throttle: number;
  /** Direction of travel against the nose (rad). */
  slip: number;
  /** Height of the road under the car (m). */
  ground: number;
  /** Surface under the front and rear axles. */
  front: SurfaceType;
  rear: SurfaceType;
}

/** Which tyres are smoking this frame, and how hard (particles per second, per tyre). */
export interface TyreWork {
  front: number;
  rear: number;
  /** Rubber goes down on the road (0-1 how dark), per axle. */
  markFront: number;
  markRear: number;
}

/** Starts wheelspin below this speed (m/s). */
const SPIN_SPEED = 18;
const SLIP_FROM = 0.07;
/** A hard stop from this fast might lock up (m/s), this often. */
const LOCK_SPEED = 35;
const LOCK_CHANCE = 0.45;

export const rollsLockup = (speed: number, random: number): boolean => speed >= LOCK_SPEED && random < LOCK_CHANCE;

/** How hard the tyres are working, from the driver's inputs; wet roads hardly smoke. */
export function tyreWork(c: { speed: number; throttle: number; slip: number; locking: boolean; wet: number }): TyreWork {
  const wet = 1 - 0.85 * Math.min(1, c.wet * 2);
  const road = c.wet < 0.3;
  const lock = c.locking && c.speed > 8 ? 26 * Math.min(1, c.speed / 40) : 0;
  const spin = c.throttle > 0.85 && c.speed > 0.5 && c.speed < SPIN_SPEED ? 44 * (1 - c.speed / SPIN_SPEED) : 0;
  const over = Math.abs(c.slip) - SLIP_FROM;
  const slide = over > 0 && c.speed > 8 ? Math.min(40, over * 320) : 0;
  return {
    front: (lock + slide) * wet,
    rear: (spin + slide) * wet,
    markFront: road ? (lock > 0 ? 0.8 : slide > 0 ? Math.min(0.8, slide / 30) : 0) : 0,
    markRear: road ? (spin > 0 ? Math.min(1, spin / 25) : slide > 0 ? Math.min(0.8, slide / 30) : 0) : 0,
  };
}

/** Dust per second per axle on this surface, and its colour; null on the road. */
export function dustOf(surface: SurfaceType, speed: number): { rate: number; color: string; stones: number } | null {
  if (speed < 5) return null;
  const pace = Math.min(1, speed / 50);
  switch (surface) {
    case 'gravel':
      return { rate: 70 * pace, color: '#cdbb94', stones: 40 * pace };
    case 'grass':
      return { rate: 34 * pace, color: '#7f8b4d', stones: 0 };
    default:
      return null;
  }
}

const AXLE_FRONT = 1.75;
const AXLE_REAR = -1.45;
const TRACK_HALF = 0.72;
const EXHAUST = -2.5;
/** No effects for cars further from the camera than this (m). */
const FX_RANGE = 350;

const SMOKE = new THREE.Color('#d6d8dc');
const HAZE = new THREE.Color('#d9dde0');
const STONE = new THREE.Color('#5f5648');
const CARBON = new THREE.Color('#2a2a2e');
const FLAME = new THREE.Color('#ff7a1e');
const FLAME_CORE = new THREE.Color('#ffe9a8');
/** A lift from this fast (m/s) can pop, this often, seen from this close (m). */
const BACKFIRE_SPEED = 45;
const BACKFIRE_CHANCE = 0.7;
const BACKFIRE_RANGE = 140;

export class TyreFx3d {
  readonly group = new THREE.Group();
  private readonly puffs = new Particles3d(700);
  private readonly flames = new Particles3d(90, { soft: 0.1, additive: true });
  private readonly stones = new Particles3d(240, { soft: 0.7 });
  private readonly marks = new SkidMarks();
  private readonly state = new Map<string, { braking: boolean; locking: boolean; onThrottle: boolean; marking: boolean; keys: string[]; owed: number[] }>();
  private readonly dust = new Map<string, THREE.Color>();

  constructor() {
    this.group.add(this.marks.mesh, this.puffs.mesh, this.stones.mesh, this.flames.mesh);
  }

  update(cars: ReadonlyMap<string, TyreCar>, wet: number, camera: THREE.Vector3, dt: number, scale: number): void {
    for (const [id, car] of cars) this.stepCar(id, car, wet, camera, dt);
    for (const id of this.state.keys()) {
      if (cars.has(id)) continue;
      this.state.delete(id);
      this.marks.lift(id);
    }
    this.puffs.update(dt, scale);
    this.stones.update(dt, scale);
    this.flames.update(dt, scale);
    this.marks.flush();
  }

  private stepCar(id: string, car: TyreCar, wet: number, camera: THREE.Vector3, dt: number): void {
    let s = this.state.get(id);
    if (!s) {
      s = { braking: false, locking: false, onThrottle: false, marking: false, keys: [`${id}:f-1`, `${id}:f1`, `${id}:r-1`, `${id}:r1`], owed: [0, 0, 0, 0, 0, 0] };
      this.state.set(id, s);
    }
    // Each hard stop might be one where the fronts lock.
    const braking = car.brake > 0.85;
    if (braking && !s.braking) s.locking = rollsLockup(car.speed, Math.random());
    if (!braking) s.locking = false;
    s.braking = braking;

    const work = tyreWork({ speed: car.speed, throttle: car.throttle, slip: car.slip, locking: s.locking, wet });
    const cos = Math.cos(car.heading);
    const sin = Math.sin(car.heading);
    const wheel = (along: number, across: number) => ({ x: car.x + cos * along - sin * across, y: car.y + sin * along + cos * across });

    // Rubber is laid at any distance: it stays there for when the camera comes round.
    const marking = work.markFront > 0 || work.markRear > 0;
    if (marking || s.marking) {
      for (let k = 0; k < 2; k++) {
        const side = k === 0 ? -1 : 1;
        const fw = wheel(AXLE_FRONT, side * TRACK_HALF);
        const rw = wheel(AXLE_REAR, side * TRACK_HALF);
        this.marks.lay(s.keys[k], fw.x, fw.y, car.ground, work.markFront);
        this.marks.lay(s.keys[k + 2], rw.x, rw.y, car.ground, work.markRear);
      }
    }
    s.marking = marking;

    // Lifting off at speed: the exhaust pops.
    const lifted = s.onThrottle && car.throttle < 0.35;
    if (car.throttle > 0.75) s.onThrottle = car.speed > BACKFIRE_SPEED;
    else if (lifted) s.onThrottle = false;

    const away = Math.hypot(car.x - camera.x, car.y - camera.z);
    if (away > FX_RANGE) return;
    if (lifted && away < BACKFIRE_RANGE && wet < 0.5 && Math.random() < BACKFIRE_CHANCE) this.backfire(car, cos, sin);
    const due = (i: number, rate: number): number => {
      s.owed[i] += rate * dt;
      const n = Math.floor(s.owed[i]);
      s.owed[i] -= n;
      return n;
    };
    const vx = cos * car.speed;
    const vy = sin * car.speed;

    // Tyre smoke.
    for (const [axle, rate] of [[AXLE_FRONT, work.front], [AXLE_REAR, work.rear]] as const) {
      const n = due(axle === AXLE_FRONT ? 0 : 1, rate * 2);
      for (let i = 0; i < n; i++) {
        const w = wheel(axle, (Math.random() < 0.5 ? -1 : 1) * TRACK_HALF);
        this.puffs.spawn({
          x: w.x, y: car.ground + 0.25, z: w.y,
          vx: vx * 0.35 + (Math.random() - 0.5) * 2.5, vy: 0.6 + Math.random() * 1.1, vz: vy * 0.35 + (Math.random() - 0.5) * 2.5,
          life: 0.7 + Math.random() * 0.9, size: 0.6, endSize: 3.6, color: SMOKE, alpha: 0.34, drag: 1.8,
        });
      }
    }

    // Dust and stones off the road.
    const axles = [[AXLE_FRONT, car.front, 2], [AXLE_REAR, car.rear, 3]] as const;
    for (const [axle, surface, slot] of axles) {
      const d = dustOf(surface, car.speed);
      if (!d) continue;
      const mud = 1 - 0.7 * Math.min(1, wet * 1.5);
      const n = due(slot, d.rate * mud);
      for (let i = 0; i < n; i++) {
        const w = wheel(axle, (Math.random() - 0.5) * 2 * TRACK_HALF);
        this.puffs.spawn({
          x: w.x, y: car.ground + 0.2, z: w.y,
          vx: vx * 0.3 + (Math.random() - 0.5) * 3, vy: 0.8 + Math.random() * 2, vz: vy * 0.3 + (Math.random() - 0.5) * 3,
          life: 0.9 + Math.random() * 1, size: 0.8, endSize: 4.6, color: this.dustColor(d.color), alpha: 0.42, drag: 1.5,
        });
      }
      const m = due(4, d.stones);
      for (let i = 0; i < m; i++) {
        const w = wheel(AXLE_REAR, (Math.random() - 0.5) * 2 * TRACK_HALF);
        this.stones.spawn({
          x: w.x, y: car.ground + 0.1, z: w.y,
          vx: vx * 0.55 + (Math.random() - 0.5) * 6, vy: 1.5 + Math.random() * 3.5, vz: vy * 0.55 + (Math.random() - 0.5) * 6,
          life: 0.5 + Math.random() * 0.5, size: 0.1, endSize: 0.08, color: STONE, alpha: 1, gravity: 9.81, floor: car.ground + 0.03,
        });
      }
    }

    // Hot air from the exhaust: most visible near a slow car. Not a true refraction (no
    // post-processing here), just a very thin rising veil.
    if (wet < 0.3 && car.speed < 60 && Math.hypot(car.x - camera.x, car.y - camera.z) < 60) {
      const n = due(5, 16 * (1 - car.speed / 60));
      const w = wheel(EXHAUST, 0);
      for (let i = 0; i < n; i++) {
        this.puffs.spawn({
          x: w.x + (Math.random() - 0.5) * 0.15, y: car.ground + 0.65, z: w.y + (Math.random() - 0.5) * 0.15,
          vx: vx * 0.7, vy: 0.9 + Math.random() * 0.8, vz: vy * 0.7,
          life: 0.5 + Math.random() * 0.4, size: 0.25, endSize: 1.1, color: HAZE, alpha: 0.05,
        });
      }
    }
  }

  /** A few flames out of the exhaust, gone in a blink. */
  private backfire(car: TyreCar, cos: number, sin: number): void {
    for (let i = 0; i < 7; i++) {
      this.flames.spawn({
        x: car.x + cos * EXHAUST, y: car.ground + 0.62, z: car.y + sin * EXHAUST,
        vx: cos * (car.speed * 0.85 - 6 - Math.random() * 7) + (Math.random() - 0.5) * 1.5,
        vy: (Math.random() - 0.3) * 1.5,
        vz: sin * (car.speed * 0.85 - 6 - Math.random() * 7) + (Math.random() - 0.5) * 1.5,
        life: 0.09 + Math.random() * 0.1, size: 0.5, endSize: 0.16, color: i < 2 ? FLAME_CORE : FLAME, alpha: 1.5,
      });
    }
  }

  /** Carbon dust where a car was hit (the sparks are in Sparks3d). */
  hit(x: number, y: number, ground: number, vx: number, vy: number, count: number): void {
    for (let i = 0; i < count; i++) {
      this.puffs.spawn({
        x: x + (Math.random() - 0.5), y: ground + 0.4, z: y + (Math.random() - 0.5),
        vx: vx * 0.5 + (Math.random() - 0.5) * 5, vy: 0.6 + Math.random() * 2, vz: vy * 0.5 + (Math.random() - 0.5) * 5,
        life: 0.5 + Math.random() * 0.5, size: 0.5, endSize: 2.4, color: CARBON, alpha: 0.5, drag: 2.5,
      });
    }
  }

  private dustColor(hex: string): THREE.Color {
    let c = this.dust.get(hex);
    if (!c) this.dust.set(hex, (c = new THREE.Color(hex)));
    return c;
  }

  /** Hide the particles for one render (Particles3d.update decides again next frame). */
  showParticles(on: boolean): void {
    this.puffs.mesh.visible = on && this.puffs.count > 0;
    this.stones.mesh.visible = on && this.stones.count > 0;
    this.flames.mesh.visible = on && this.flames.count > 0;
  }

  clearMarks(): void {
    this.marks.clear();
  }

  /** Rubber lines on the road right now (for checking). */
  get markCount(): number {
    return this.marks.count;
  }

  dispose(): void {
    this.puffs.dispose();
    this.stones.dispose();
    this.flames.dispose();
    this.marks.dispose();
  }
}

const MAX_MARKS = 3000;
const MARK_WIDTH = 0.34;
const MARK_LIFT = 0.03;
/** A new piece of rubber every so far along (m); further than the jump limit starts a new line. */
const MARK_STEP = 1.2;
const MARK_JUMP = 12;

/** Rubber on the road: a ring of thin dark quads. The oldest go when it is full, so a long race never grows. */
class SkidMarks {
  readonly mesh: THREE.Mesh;
  private readonly geo = new THREE.BufferGeometry();
  private readonly mat = new THREE.MeshBasicMaterial({
    color: '#0a0a0b',
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -6,
    polygonOffsetUnits: -8,
  });
  private readonly pos: THREE.BufferAttribute;
  private readonly col: THREE.BufferAttribute;
  private readonly last = new Map<string, { x: number; y: number; h: number; lx: number; ly: number; a: number }>();
  private next = 0;
  private laid = 0;
  private dirty = false;

  constructor() {
    this.pos = new THREE.BufferAttribute(new Float32Array(MAX_MARKS * 12), 3);
    this.col = new THREE.BufferAttribute(new Float32Array(MAX_MARKS * 16).fill(1), 4);
    for (let i = 0; i < MAX_MARKS; i++) for (let v = 0; v < 4; v++) (this.col.array as Float32Array)[i * 16 + v * 4 + 3] = 0;
    this.pos.setUsage(THREE.DynamicDrawUsage);
    this.col.setUsage(THREE.DynamicDrawUsage);
    const index = new Uint32Array(MAX_MARKS * 6);
    for (let i = 0; i < MAX_MARKS; i++) index.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 2, i * 4 + 1, i * 4 + 3], i * 6);
    this.geo.setIndex(new THREE.BufferAttribute(index, 1));
    this.geo.setAttribute('position', this.pos);
    this.geo.setAttribute('color', this.col);
    this.geo.setDrawRange(0, 0);
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  /** Clean road again. */
  clear(): void {
    this.last.clear();
    this.next = this.laid = 0;
    this.geo.setDrawRange(0, 0);
    const col = this.col.array as Float32Array;
    for (let i = 3; i < col.length; i += 4) col[i] = 0;
    this.col.clearUpdateRanges();
    this.pos.clearUpdateRanges();
    this.col.needsUpdate = true;
    this.mesh.visible = false;
  }

  /** Stop any lines of this car (it left, or was reset). */
  lift(id: string): void {
    for (const key of this.last.keys()) if (key.startsWith(`${id}:`)) this.last.delete(key);
  }

  /** A tyre at this point, laying this much rubber (0: none, the line ends). */
  lay(key: string, x: number, y: number, ground: number, amount: number): void {
    if (amount <= 0) {
      this.last.delete(key);
      return;
    }
    const prev = this.last.get(key);
    const h = ground + MARK_LIFT;
    if (!prev) {
      this.last.set(key, { x, y, h, lx: 0, ly: 0, a: 0 });
      return;
    }
    const dx = x - prev.x;
    const dy = y - prev.y;
    const d = Math.hypot(dx, dy);
    if (d < MARK_STEP) return;
    if (d > MARK_JUMP) {
      this.last.set(key, { x, y, h, lx: 0, ly: 0, a: 0 });
      return;
    }
    // Across the line of travel.
    const lx = (-dy / d) * MARK_WIDTH * 0.5;
    const ly = (dx / d) * MARK_WIDTH * 0.5;
    const a = 0.34 * amount;
    const startX = prev.a > 0 ? prev.lx : lx;
    const startY = prev.a > 0 ? prev.ly : ly;
    const pos = this.pos.array as Float32Array;
    const col = this.col.array as Float32Array;
    const i = this.next;
    pos.set([prev.x + startX, prev.h, prev.y + startY, prev.x - startX, prev.h, prev.y - startY, x + lx, h, y + ly, x - lx, h, y - ly], i * 12);
    // Fades in from nothing at the start of a line.
    for (const [v, alpha] of [[0, prev.a], [1, prev.a], [2, a], [3, a]]) col[i * 16 + v * 4 + 3] = alpha;
    this.pos.addUpdateRange(i * 12, 12);
    this.col.addUpdateRange(i * 16, 16);
    this.next = (i + 1) % MAX_MARKS;
    this.laid = Math.min(MAX_MARKS, this.laid + 1);
    this.geo.setDrawRange(0, this.laid * 6);
    this.dirty = true;
    this.last.set(key, { x, y, h, lx, ly, a });
  }

  flush(): void {
    if (!this.dirty) return;
    this.dirty = false;
    this.mesh.visible = true;
    this.pos.needsUpdate = this.col.needsUpdate = true;
  }

  get count(): number {
    return this.laid;
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
  }
}
