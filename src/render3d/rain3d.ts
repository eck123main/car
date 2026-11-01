import * as THREE from 'three';

/**
 * Rain in the 3D view (looks only): drops falling round the camera, streaking towards you at
 * speed, and spray thrown up behind every car on a wet track. Plus `Visor`: drops on the
 * driver's visor in the cockpit, blown off by the airflow at speed.
 */

const DROPS = 1400;
/** Box of rain round the camera (m): half width, height. */
const BOX = 32;
const BOX_H = 22;
const FALL = 11;
const SPRAY = 700;

/** What spray needs from a car. */
export interface SprayCar {
  x: number;
  y: number;
  heading: number;
  speed: number;
  ground: number;
}

/** Spray particles per second behind a car: none slow or dry, a cloud at speed in the wet. */
export function sprayRate(speed: number, wetness: number): number {
  if (wetness < 0.15 || speed < 8) return 0;
  return Math.min(120, (speed - 8) * 1.6 * wetness);
}

/** A soft round blob, for spray. */
function blobTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Rain3d {
  readonly group = new THREE.Group();
  private readonly drops = new Float32Array(DROPS * 3);
  private readonly lines: THREE.LineSegments;
  private readonly lineMat: THREE.LineBasicMaterial;
  private readonly spray: THREE.Points;
  private readonly sprayMat: THREE.PointsMaterial;
  private readonly sPos = new Float32Array(SPRAY * 3);
  private readonly sVel = new Float32Array(SPRAY * 3);
  private readonly sAge = new Float32Array(SPRAY);
  private readonly sLife = new Float32Array(SPRAY);
  private readonly sCol: THREE.BufferAttribute;
  private readonly owed = new Map<string, number>();
  private next = 0;
  private readonly blob = blobTexture();

  constructor() {
    for (let i = 0; i < DROPS; i++) {
      this.drops[i * 3] = (Math.random() * 2 - 1) * BOX;
      this.drops[i * 3 + 1] = Math.random() * BOX_H;
      this.drops[i * 3 + 2] = (Math.random() * 2 - 1) * BOX;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(DROPS * 6), 3).setUsage(THREE.DynamicDrawUsage));
    this.lineMat = new THREE.LineBasicMaterial({ color: '#e2e8ef', transparent: true, opacity: 0, depthWrite: false });
    this.lines = new THREE.LineSegments(geo, this.lineMat);
    this.lines.frustumCulled = false;

    const sGeo = new THREE.BufferGeometry();
    sGeo.setAttribute('position', new THREE.BufferAttribute(this.sPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.sCol = new THREE.BufferAttribute(new Float32Array(SPRAY * 4), 4).setUsage(THREE.DynamicDrawUsage);
    sGeo.setAttribute('color', this.sCol);
    this.sprayMat = new THREE.PointsMaterial({ size: 3.4, map: this.blob, vertexColors: true, transparent: true, depthWrite: false, sizeAttenuation: true });
    this.spray = new THREE.Points(sGeo, this.sprayMat);
    this.spray.frustumCulled = false;
    this.group.add(this.lines, this.spray);
  }

  /**
   * rain: how hard it is raining (0-1); wetness: how wet the track is (spray). camera: where the
   * rain is drawn round; carVel: the viewer's velocity (m/s, world x/z), so drops streak past.
   */
  update(rain: number, wetness: number, camera: THREE.Vector3, carVel: THREE.Vector3, cars: ReadonlyMap<string, SprayCar>, dt: number): void {
    dt = Math.min(dt, 0.05);
    const raining = rain > 0.05;
    this.lines.visible = raining;
    if (raining) this.updateDrops(rain, camera, carVel, dt);
    this.updateSpray(wetness, cars, dt);
  }

  private updateDrops(wetness: number, cam: THREE.Vector3, carVel: THREE.Vector3, dt: number): void {
    this.lineMat.opacity = 0.3 + 0.4 * wetness;
    const p = (this.lines.geometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
    // The streak is the drop's movement relative to the viewer over ~1/30 s.
    const sx = carVel.x * 0.028;
    const sy = FALL * 0.035;
    const sz = carVel.z * 0.028;
    const shown = Math.floor(DROPS * Math.min(1, 0.3 + wetness));
    for (let i = 0; i < DROPS; i++) {
      const j = i * 3;
      this.drops[j + 1] -= FALL * dt;
      // Drops live in a box that moves with the camera: wrap round it.
      let x = this.drops[j] - cam.x;
      let z = this.drops[j + 2] - cam.z;
      x = ((((x + BOX) % (2 * BOX)) + 2 * BOX) % (2 * BOX)) - BOX;
      z = ((((z + BOX) % (2 * BOX)) + 2 * BOX) % (2 * BOX)) - BOX;
      let y = this.drops[j + 1] - (cam.y - 6);
      if (y < 0) y += BOX_H;
      this.drops[j] = cam.x + x;
      this.drops[j + 1] = cam.y - 6 + y;
      this.drops[j + 2] = cam.z + z;
      const k = i * 6;
      if (i >= shown) {
        p.fill(0, k, k + 6);
        p[k] = p[k + 3] = cam.x;
        p[k + 1] = p[k + 4] = cam.y - 100;
        p[k + 2] = p[k + 5] = cam.z;
        continue;
      }
      p[k] = this.drops[j];
      p[k + 1] = this.drops[j + 1];
      p[k + 2] = this.drops[j + 2];
      p[k + 3] = this.drops[j] + sx;
      p[k + 4] = this.drops[j + 1] + sy;
      p[k + 5] = this.drops[j + 2] + sz;
    }
    this.lines.geometry.getAttribute('position').needsUpdate = true;
  }

  private updateSpray(wetness: number, cars: ReadonlyMap<string, SprayCar>, dt: number): void {
    for (const [id, car] of cars) {
      const owed = (this.owed.get(id) ?? 0) + sprayRate(car.speed, wetness) * dt;
      let n = Math.floor(owed);
      this.owed.set(id, owed - n);
      while (n-- > 0) this.spawn(car);
    }
    for (const id of this.owed.keys()) if (!cars.has(id)) this.owed.delete(id);
    const col = this.sCol.array as Float32Array;
    let any = false;
    for (let i = 0; i < SPRAY; i++) {
      const j = i * 3;
      if (this.sAge[i] >= this.sLife[i]) {
        col[i * 4 + 3] = 0;
        continue;
      }
      any = true;
      this.sAge[i] += dt;
      // Air drag slows the mist quickly; it drifts up a little and hangs.
      const drag = Math.exp(-2.5 * dt);
      this.sVel[j] *= drag;
      this.sVel[j + 2] *= drag;
      this.sVel[j + 1] = this.sVel[j + 1] * drag + 0.3 * dt;
      for (let k = 0; k < 3; k++) this.sPos[j + k] += this.sVel[j + k] * dt;
      const t = this.sAge[i] / this.sLife[i];
      col[i * 4] = col[i * 4 + 1] = 0.86;
      col[i * 4 + 2] = 0.9;
      col[i * 4 + 3] = 0.38 * Math.sin(Math.PI * Math.min(1, t * 1.6 + 0.1)) * (1 - t);
    }
    this.spray.visible = any;
    if (any) {
      this.spray.geometry.getAttribute('position').needsUpdate = true;
      this.sCol.needsUpdate = true;
    }
  }

  private spawn(car: SprayCar): void {
    const i = this.next;
    this.next = (this.next + 1) % SPRAY;
    const cos = Math.cos(car.heading);
    const sin = Math.sin(car.heading);
    // Off the rear tyres (either side), and some off the diffuser in the middle.
    const across = (Math.random() < 0.7 ? Math.sign(Math.random() - 0.5) * 0.75 : 0) + (Math.random() - 0.5) * 0.4;
    const along = -2 - Math.random() * 0.6;
    const j = i * 3;
    this.sPos[j] = car.x + cos * along - sin * across;
    this.sPos[j + 1] = car.ground + 0.3 + Math.random() * 0.5;
    this.sPos[j + 2] = car.y + sin * along + cos * across;
    // Thrown up and back: in the world it trails behind the car at a fraction of its speed.
    const fwd = car.speed * (0.35 + Math.random() * 0.3);
    const side = (Math.random() - 0.5) * 4;
    this.sVel[j] = cos * fwd - sin * side;
    this.sVel[j + 1] = 1 + Math.random() * 2.5;
    this.sVel[j + 2] = sin * fwd + cos * side;
    this.sAge[i] = 0;
    this.sLife[i] = 0.8 + Math.random() * 0.9;
  }

  dispose(): void {
    this.lines.geometry.dispose();
    this.lineMat.dispose();
    this.spray.geometry.dispose();
    this.sprayMat.dispose();
    this.blob.dispose();
  }
}

/** One drop on the visor (screen share 0-1, radius in px of a 512-wide canvas). */
interface VisorDrop {
  x: number;
  y: number;
  r: number;
  age: number;
  life: number;
}

const VISOR_W = 512;
const VISOR_H = 288;

/**
 * Drops landing on the driver's visor. Standing still they sit and slowly run down; at speed
 * the airflow blows them outwards and up off the visor. Drawn into a canvas shown over the
 * whole screen in the cockpit cameras.
 */
export class Visor {
  readonly canvas = document.createElement('canvas');
  readonly texture: THREE.CanvasTexture;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly drops: VisorDrop[] = [];
  private owed = 0;
  private empty = true;

  constructor() {
    this.canvas.width = VISOR_W;
    this.canvas.height = VISOR_H;
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
  }

  /** True while there is something to draw. */
  get visible(): boolean {
    return !this.empty;
  }

  update(raining: number, speed: number, dt: number): void {
    dt = Math.min(dt, 0.05);
    // Fewer land at speed (the airflow over the cockpit), but some always do.
    this.owed += raining > 0.05 ? raining * (14 - Math.min(8, speed / 10)) * dt : 0;
    while (this.owed >= 1 && this.drops.length < 80) {
      this.owed -= 1;
      this.drops.push({ x: Math.random(), y: Math.random() * 0.85, r: 3 + Math.random() * 7, age: 0, life: 2 + Math.random() * 4 });
    }
    const blow = Math.min(1, speed / 60);
    for (const d of this.drops) {
      d.age += dt;
      // Blown away from the middle of the visor and up; when still, running slowly down.
      const out = d.x - 0.5;
      d.x += out * blow * 1.6 * dt;
      d.y += (blow * -0.35 + (1 - blow) * 0.015) * dt;
    }
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      if (d.age > d.life || d.x < -0.05 || d.x > 1.05 || d.y < -0.05 || d.y > 1.05) this.drops.splice(i, 1);
    }
    this.draw(blow);
  }

  private draw(blow: number): void {
    const c = this.ctx;
    c.clearRect(0, 0, VISOR_W, VISOR_H);
    this.empty = this.drops.length === 0;
    if (this.empty) {
      this.texture.needsUpdate = true;
      return;
    }
    for (const d of this.drops) {
      const fade = Math.min(1, (d.life - d.age) / 0.6) * Math.min(1, d.age / 0.08);
      const x = d.x * VISOR_W;
      const y = d.y * VISOR_H;
      // Stretched along the airflow at speed.
      const stretch = 1 + blow * 1.5;
      const ang = Math.atan2(-0.35 * blow, (d.x - 0.5) * 1.6 * blow + 1e-6);
      c.save();
      c.translate(x, y);
      if (blow > 0.1) c.rotate(ang);
      c.scale(blow > 0.1 ? stretch : 1, 1);
      // A drop: darker edge, clearer middle, a bright highlight.
      c.globalAlpha = 0.5 * fade;
      c.fillStyle = 'rgba(30,40,55,0.55)';
      c.beginPath();
      c.arc(0, 0, d.r, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = 'rgba(200,215,230,0.35)';
      c.beginPath();
      c.arc(0, 0, d.r * 0.72, 0, Math.PI * 2);
      c.fill();
      c.globalAlpha = 0.8 * fade;
      c.fillStyle = 'rgba(255,255,255,0.9)';
      c.beginPath();
      c.arc(-d.r * 0.3, -d.r * 0.35, d.r * 0.22, 0, Math.PI * 2);
      c.fill();
      c.restore();
    }
    c.globalAlpha = 1;
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.texture.dispose();
  }
}
