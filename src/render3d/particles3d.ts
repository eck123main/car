import * as THREE from 'three';

/**
 * Soft round particles for smoke, dust, stones, confetti and fireworks (looks only). One Points
 * mesh per system, one draw call; each particle has its own size, colour and fade, which a plain
 * PointsMaterial can't do.
 */

export interface ParticleSpec {
  /** World position (three.js axes: y up) and velocity (m/s). */
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Seconds. */
  life: number;
  /** Size across (m) at the start and the end. */
  size: number;
  endSize: number;
  color: THREE.Color;
  alpha: number;
  /** Pull downwards (m/s²; negative: rises). */
  gravity?: number;
  /** Air slowing it (1/s). */
  drag?: number;
  /** Stops at this height (bounces a little), if set. */
  floor?: number;
}

/** How visible a particle is through its life: quick fade in, slow fade out. */
export function particleFade(t: number): number {
  return Math.min(1, t * 8) * (1 - t) * (1 - t * 0.3);
}

const VERTEX = /* glsl */ `
attribute vec4 aColor;
attribute float aSize;
uniform float uScale;
varying vec4 vColor;
void main() {
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = min(aSize * uScale / max(-mv.z, 0.01), 600.0);
  gl_Position = projectionMatrix * mv;
}`;

const FRAGMENT = /* glsl */ `
uniform float uSoft;
varying vec4 vColor;
void main() {
  float a = 1.0 - smoothstep(uSoft, 1.0, length(gl_PointCoord - 0.5) * 2.0);
  if (a * vColor.a < 0.004) discard;
  gl_FragColor = vec4(vColor.rgb, vColor.a * a);
  #include <colorspace_fragment>
}`;

export class Particles3d {
  readonly mesh: THREE.Points;
  private readonly geo = new THREE.BufferGeometry();
  private readonly mat: THREE.ShaderMaterial;
  private readonly pos: THREE.BufferAttribute;
  private readonly col: THREE.BufferAttribute;
  private readonly sizeAttr: THREE.BufferAttribute;
  private readonly specs: (ParticleSpec | null)[];
  private readonly age: Float32Array;
  private next = 0;
  private alive = 0;
  private fresh = false;

  /** soft: how much of the disc is solid (0 = a soft puff, 0.8 = a hard dot). */
  constructor(private readonly max: number, opts: { soft?: number; additive?: boolean } = {}) {
    this.specs = new Array<ParticleSpec | null>(max).fill(null);
    this.age = new Float32Array(max);
    this.pos = new THREE.BufferAttribute(new Float32Array(max * 3), 3);
    this.col = new THREE.BufferAttribute(new Float32Array(max * 4), 4);
    this.sizeAttr = new THREE.BufferAttribute(new Float32Array(max), 1);
    for (const a of [this.pos, this.col, this.sizeAttr]) a.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', this.pos);
    this.geo.setAttribute('aColor', this.col);
    this.geo.setAttribute('aSize', this.sizeAttr);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: { uScale: { value: 500 }, uSoft: { value: opts.soft ?? 0 } },
      transparent: true,
      depthWrite: false,
      blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.mesh = new THREE.Points(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  spawn(p: ParticleSpec): void {
    this.specs[this.next] = p;
    this.age[this.next] = 0;
    this.next = (this.next + 1) % this.max;
    this.fresh = true;
  }

  /** scale: pixels per metre at 1 m from the camera. */
  update(dt: number, scale: number): void {
    // Nothing alive: no loop, no upload.
    if (this.alive === 0 && !this.fresh) {
      this.mesh.visible = false;
      return;
    }
    this.fresh = false;
    dt = Math.min(dt, 0.05);
    const pos = this.pos.array as Float32Array;
    const col = this.col.array as Float32Array;
    const size = this.sizeAttr.array as Float32Array;
    let alive = 0;
    for (let i = 0; i < this.max; i++) {
      const p = this.specs[i];
      if (!p) {
        size[i] = 0;
        col[i * 4 + 3] = 0;
        continue;
      }
      this.age[i] += dt;
      const t = this.age[i] / p.life;
      if (t >= 1) {
        this.specs[i] = null;
        size[i] = 0;
        col[i * 4 + 3] = 0;
        continue;
      }
      alive++;
      const slow = Math.exp(-(p.drag ?? 0) * dt);
      p.vx *= slow;
      p.vy = p.vy * slow - (p.gravity ?? 0) * dt;
      p.vz *= slow;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.floor !== undefined && p.y < p.floor) {
        p.y = p.floor;
        p.vy = Math.abs(p.vy) * 0.3;
        p.vx *= 0.6;
        p.vz *= 0.6;
      }
      pos[i * 3] = p.x;
      pos[i * 3 + 1] = p.y;
      pos[i * 3 + 2] = p.z;
      col[i * 4] = p.color.r;
      col[i * 4 + 1] = p.color.g;
      col[i * 4 + 2] = p.color.b;
      col[i * 4 + 3] = p.alpha * particleFade(t);
      size[i] = p.size + (p.endSize - p.size) * t;
    }
    this.alive = alive;
    this.mesh.visible = alive > 0;
    if (alive === 0) return;
    this.mat.uniforms.uScale.value = scale;
    this.pos.needsUpdate = this.col.needsUpdate = this.sizeAttr.needsUpdate = true;
  }

  get count(): number {
    return this.alive;
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
  }
}
