import * as THREE from 'three';

/**
 * Sparks from the cars' floors (looks only): the skid blocks scrape the road when the car is
 * pressed down hard, in compressions (Eau Rouge) and at top speed. Each spark is a short bright
 * streak that flies back off the car, bounces on the road and fades. One LineSegments mesh,
 * additive, a few hundred sparks at most.
 */

const MAX = 360;
const G = 9.81;

/** What sparks need from a car this frame. */
export interface SparkCar {
  x: number;
  y: number;
  heading: number;
  speed: number;
  /** How hard the road presses the car down: 1 flat, more in a dip (Car.step's weight). */
  weight: number;
  /** Height of the road under the car (m). */
  ground: number;
}

/**
 * Sparks per second from one car: none at normal speeds on flat road, a few at top speed,
 * a shower when bottoming out in a compression.
 */
export function sparkRate(speed: number, weight: number): number {
  if (speed < 40) return 0;
  const fast = Math.max(0, (speed - 72) / 18) * 18;
  const pressed = Math.max(0, weight - 1.12) * 260 * Math.min(1, speed / 60);
  return Math.min(160, fast + pressed);
}

/** A small soft glow. */
function dotTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.6)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
}

export class Sparks3d {
  /** The streaks and a glowing dot at each end (same geometry). */
  readonly mesh = new THREE.Group();
  private readonly lines: THREE.LineSegments;
  private readonly dots: THREE.Points;
  private readonly dot: THREE.Texture;
  private readonly pos = new Float32Array(MAX * 3);
  private readonly vel = new Float32Array(MAX * 3);
  private readonly ground = new Float32Array(MAX);
  private readonly life = new Float32Array(MAX);
  private readonly age = new Float32Array(MAX);
  private readonly positions: THREE.BufferAttribute;
  private readonly colors: THREE.BufferAttribute;
  private readonly owed = new Map<string, number>();
  private next = 0;
  private active = 0;
  private fresh = false;

  constructor() {
    const geo = new THREE.BufferGeometry();
    this.positions = new THREE.BufferAttribute(new Float32Array(MAX * 6), 3);
    this.colors = new THREE.BufferAttribute(new Float32Array(MAX * 6), 3);
    this.positions.setUsage(THREE.DynamicDrawUsage);
    this.colors.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.positions);
    geo.setAttribute('color', this.colors);
    const mat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    this.lines = new THREE.LineSegments(geo, mat);
    this.lines.frustumCulled = false;
    this.dot = dotTexture();
    const dotMat = new THREE.PointsMaterial({ size: 0.22, map: this.dot, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    this.dots = new THREE.Points(geo, dotMat);
    this.dots.frustumCulled = false;
    this.mesh.add(this.lines, this.dots);
  }

  update(cars: ReadonlyMap<string, SparkCar>, dt: number): void {
    dt = Math.min(dt, 0.05);
    for (const [id, car] of cars) {
      const owed = (this.owed.get(id) ?? 0) + sparkRate(car.speed, car.weight) * dt;
      let n = Math.floor(owed);
      this.owed.set(id, owed - n);
      while (n-- > 0) this.spawn(car);
    }
    for (const id of this.owed.keys()) if (!cars.has(id)) this.owed.delete(id);
    // Nothing flying: no loop, no upload.
    if (this.active === 0 && !this.fresh) {
      this.mesh.visible = false;
      return;
    }
    this.mesh.visible = true;
    this.fresh = false;
    let active = 0;

    const p = this.positions.array as Float32Array;
    const c = this.colors.array as Float32Array;
    for (let i = 0; i < MAX; i++) {
      const j = i * 3;
      if (this.age[i] >= this.life[i]) {
        // Dead: a zero-length black line draws nothing (additive).
        c.fill(0, i * 6, i * 6 + 6);
        continue;
      }
      active++;
      this.age[i] += dt;
      this.vel[j + 1] -= G * dt;
      for (let k = 0; k < 3; k++) this.pos[j + k] += this.vel[j + k] * dt;
      // Bounce on the road, losing most of the speed.
      if (this.pos[j + 1] < this.ground[i] + 0.02) {
        this.pos[j + 1] = this.ground[i] + 0.02;
        this.vel[j + 1] = Math.abs(this.vel[j + 1]) * 0.35;
        this.vel[j] *= 0.7;
        this.vel[j + 2] *= 0.7;
      }
      // A streak along its movement: the head bright, the tail where it was ~1/40 s ago.
      const t = 1 - this.age[i] / this.life[i];
      for (let k = 0; k < 3; k++) {
        p[i * 6 + k] = this.pos[j + k];
        p[i * 6 + 3 + k] = this.pos[j + k] - this.vel[j + k] * 0.04;
      }
      // White-hot to orange, fading out.
      const r = t;
      const g = t * (0.45 + 0.5 * t);
      const b = t * t * 0.5;
      c.set([r, g, b, r * 0.6, g * 0.4, b * 0.2], i * 6);
    }
    this.active = active;
    this.positions.needsUpdate = true;
    this.colors.needsUpdate = true;
  }

  /** A shower from a hit: flying every way from where the cars touched. */
  burst(x: number, y: number, ground: number, vx: number, vy: number, count: number): void {
    for (let n = 0; n < count; n++) {
      const i = this.next;
      this.next = (this.next + 1) % MAX;
      const j = i * 3;
      const a = Math.random() * Math.PI * 2;
      const out = 3 + Math.random() * 12;
      this.pos[j] = x;
      this.pos[j + 1] = ground + 0.3;
      this.pos[j + 2] = y;
      this.vel[j] = vx * 0.6 + Math.cos(a) * out;
      this.vel[j + 1] = 1 + Math.random() * 5;
      this.vel[j + 2] = vy * 0.6 + Math.sin(a) * out;
      this.ground[i] = ground;
      this.age[i] = 0;
      this.life[i] = 0.3 + Math.random() * 0.4;
    }
    this.fresh = true;
  }

  private spawn(car: SparkCar): void {
    const i = this.next;
    this.next = (this.next + 1) % MAX;
    const cos = Math.cos(car.heading);
    const sin = Math.sin(car.heading);
    // Under the back of the floor, anywhere across the plank.
    const along = -1.4 - Math.random() * 0.5;
    const across = (Math.random() - 0.5) * 0.7;
    const j = i * 3;
    this.pos[j] = car.x + cos * along - sin * across;
    this.pos[j + 1] = car.ground + 0.05;
    this.pos[j + 2] = car.y + sin * along + cos * across;
    // Dragged along by the car but slower, so they stream out behind it, spraying up and out.
    const fwd = car.speed * (0.55 + Math.random() * 0.3);
    const side = (Math.random() - 0.5) * 7;
    this.vel[j] = cos * fwd - sin * side;
    this.vel[j + 1] = 0.8 + Math.random() * 2.5;
    this.vel[j + 2] = sin * fwd + cos * side;
    this.ground[i] = car.ground;
    this.age[i] = 0;
    this.life[i] = 0.25 + Math.random() * 0.35;
    this.fresh = true;
  }

  dispose(): void {
    this.lines.geometry.dispose();
    (this.lines.material as THREE.Material).dispose();
    (this.dots.material as THREE.Material).dispose();
    this.dot.dispose();
  }
}
