import * as THREE from 'three';

/**
 * Car lights after dark and in the rain (looks only): a pool of light on the road ahead of each
 * car, a glowing red tail light (blinking in the wet, as the real rain light does) and its red
 * reflection stretched along the road. Three shared meshes, drawn only when the race needs them.
 */

/** How strong the lights are: full at night, some at dusk, none on a dry day (headlights), a wet road always shows the tail light. */
export function lightStrength(sky: 'day' | 'dusk' | 'night', wetness: number): { beam: number; tail: number; streak: number } {
  const dark = sky === 'night' ? 1 : sky === 'dusk' ? 0.55 : 0;
  const wet = Math.min(1, wetness * 2);
  return { beam: dark, tail: Math.max(dark, wet), streak: Math.max(dark * 0.35, dark * wet, wet * 0.55) };
}

/** Real rain lights flash about 4 times a second; off the wet they just glow. */
export function tailOn(time: number, wetness: number): boolean {
  return wetness < 0.15 || Math.floor(time * 8) % 2 === 0;
}

export interface LitCar {
  x: number;
  y: number;
  heading: number;
  ground: number;
}

const MAX_CARS = 12;
const BEAM_AHEAD = 8;
const TAIL_BACK = 2.75;
const TAIL_HEIGHT = 0.55;
const NOSE = 2.6;

function glowTexture(stretch: boolean): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = stretch ? g.createLinearGradient(0, 0, 0, 64) : g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(stretch ? 0.2 : 0.3, stretch ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

const flatMaterial = (map: THREE.Texture, color: string) =>
  new THREE.MeshBasicMaterial({
    map,
    color,
    transparent: true,
    opacity: 1,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
    polygonOffset: true,
    polygonOffsetFactor: -8,
    polygonOffsetUnits: -10,
  });

export class CarLights3d {
  /** In the world: pools of light, reflections and the other cars' lights. */
  readonly group = new THREE.Group();
  /** Our own car's tail light, for the pass that draws it over the world. */
  readonly nearGroup = new THREE.Group();
  private readonly glow = glowTexture(false);
  private readonly fade = glowTexture(true);
  private readonly beamGeo = new THREE.PlaneGeometry(9, 15).rotateX(-Math.PI / 2);
  private readonly streakGeo = new THREE.PlaneGeometry(1.1, 7).rotateX(-Math.PI / 2);
  private readonly beamMat = flatMaterial(this.glow, '#ffe9c0');
  private readonly streakMat = flatMaterial(this.fade, '#ff2418');
  private readonly beams = new THREE.InstancedMesh(this.beamGeo, this.beamMat, MAX_CARS);
  private readonly streaks = new THREE.InstancedMesh(this.streakGeo, this.streakMat, MAX_CARS);
  private readonly tails: THREE.Points;
  private readonly heads: THREE.Points;
  private readonly ownTail: THREE.Points;
  private readonly tailAttr = new THREE.BufferAttribute(new Float32Array(MAX_CARS * 3), 3);
  private readonly headAttr = new THREE.BufferAttribute(new Float32Array(MAX_CARS * 3), 3);
  private readonly ownAttr = new THREE.BufferAttribute(new Float32Array(3), 3);
  private readonly tailMat: THREE.PointsMaterial;
  private readonly headMat: THREE.PointsMaterial;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();

  constructor() {
    const points = (attr: THREE.BufferAttribute, mat: THREE.PointsMaterial) => {
      const geo = new THREE.BufferGeometry();
      attr.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('position', attr);
      const p = new THREE.Points(geo, mat);
      p.frustumCulled = false;
      return p;
    };
    const dot = (color: string, size: number) =>
      new THREE.PointsMaterial({ map: this.glow, color, size, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    this.tailMat = dot('#ff2a1c', 1.5);
    this.headMat = dot('#fff1cf', 1.1);
    this.tails = points(this.tailAttr, this.tailMat);
    this.heads = points(this.headAttr, this.headMat);
    this.ownTail = points(this.ownAttr, this.tailMat);
    this.beams.frustumCulled = this.streaks.frustumCulled = false;
    this.group.add(this.beams, this.streaks, this.tails, this.heads);
    this.nearGroup.add(this.ownTail);
    this.group.visible = this.nearGroup.visible = false;
  }

  update(cars: readonly LitCar[], own: LitCar, sky: 'day' | 'dusk' | 'night', wetness: number, time: number): void {
    const s = lightStrength(sky, wetness);
    const on = s.beam > 0 || s.tail > 0;
    this.group.visible = this.nearGroup.visible = on;
    if (!on) return;
    const lit = tailOn(time, wetness);
    this.beamMat.opacity = 0.34 * s.beam;
    this.streakMat.opacity = (lit ? 0.5 : 0.18) * s.streak;
    this.tailMat.opacity = lit ? s.tail : s.tail * 0.15;
    this.headMat.opacity = s.beam;
    this.beams.visible = this.heads.visible = s.beam > 0;

    const up = new THREE.Vector3(0, 1, 0);
    const one = new THREE.Vector3(1, 1, 1);
    const n = Math.min(MAX_CARS, cars.length);
    const tail = this.tailAttr.array as Float32Array;
    const head = this.headAttr.array as Float32Array;
    for (let i = 0; i < n; i++) {
      const c = cars[i];
      const cos = Math.cos(c.heading);
      const sin = Math.sin(c.heading);
      // Plane's long side (z) along the car's heading.
      this.q.setFromAxisAngle(up, Math.PI / 2 - c.heading);
      this.m.compose(this.v.set(c.x + cos * BEAM_AHEAD, c.ground + 0.05, c.y + sin * BEAM_AHEAD), this.q, one);
      this.beams.setMatrixAt(i, this.m);
      this.m.compose(this.v.set(c.x - cos * (TAIL_BACK + 3.2), c.ground + 0.05, c.y - sin * (TAIL_BACK + 3.2)), this.q, one);
      this.streaks.setMatrixAt(i, this.m);
      // The driver's own tail light goes in the near pass, or the car would be drawn over it.
      const isOwn = c === own;
      tail.set(isOwn ? [0, -1000, 0] : [c.x - cos * TAIL_BACK, c.ground + TAIL_HEIGHT, c.y - sin * TAIL_BACK], i * 3);
      head.set(isOwn ? [0, -1000, 0] : [c.x + cos * NOSE, c.ground + 0.42, c.y + sin * NOSE], i * 3);
    }
    (this.ownAttr.array as Float32Array).set([own.x - Math.cos(own.heading) * TAIL_BACK, own.ground + TAIL_HEIGHT, own.y - Math.sin(own.heading) * TAIL_BACK]);
    this.beams.count = this.streaks.count = n;
    this.beams.instanceMatrix.needsUpdate = this.streaks.instanceMatrix.needsUpdate = true;
    this.tails.geometry.setDrawRange(0, n);
    this.heads.geometry.setDrawRange(0, n);
    this.tailAttr.needsUpdate = this.headAttr.needsUpdate = this.ownAttr.needsUpdate = true;
  }

  dispose(): void {
    for (const d of [this.glow, this.fade, this.beamGeo, this.streakGeo, this.beamMat, this.streakMat, this.tailMat, this.headMat, this.tails.geometry, this.heads.geometry, this.ownTail.geometry, this.beams, this.streaks]) d.dispose();
  }
}
