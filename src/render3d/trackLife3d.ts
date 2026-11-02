import * as THREE from 'three';
import type { Track } from '../track/track';

/**
 * Cheap life round the track (looks only): drifting clouds and rubber marbles off the line. Two
 * draw calls and almost nothing per frame on the CPU.
 */

/** How far through the "day" a race is makes the light go: none at night. */
export function sunsetShare(sky: 'day' | 'dusk' | 'night', progress: number): number {
  const p = Math.max(0, Math.min(1, progress));
  return sky === 'night' ? 0 : sky === 'dusk' ? p * 0.4 : p;
}

const CLOUD_HEIGHT = 300;
const CLOUD_RADIUS = 2300;
const CLOUD_DRIFT = 0.0035;

function cloudTexture(): THREE.CanvasTexture {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  let seed = 7;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  // Soft blobs, each drawn at the wrapped positions too, so the picture tiles without a seam.
  for (let i = 0; i < 46; i++) {
    const x = rnd() * size;
    const y = rnd() * size;
    const r = 10 + rnd() * 34;
    for (const dx of [-size, 0, size]) {
      for (const dy of [-size, 0, size]) {
        const grad = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
        grad.addColorStop(0, 'rgba(255,255,255,0.6)');
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = grad;
        g.fillRect(x + dx - r, y + dy - r, r * 2, r * 2);
      }
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 3);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** One big disc of cloud overhead, following the camera and fading out towards the horizon. */
export class Clouds3d {
  readonly mesh: THREE.Mesh;
  private readonly tex = cloudTexture();
  private readonly geo = new THREE.CircleGeometry(CLOUD_RADIUS, 32).rotateX(Math.PI / 2);
  private readonly mat: THREE.MeshBasicMaterial;
  private readonly clear: number;

  constructor(sky: 'day' | 'dusk' | 'night') {
    const pos = this.geo.getAttribute('position');
    const colors = new Float32Array(pos.count * 4).fill(1);
    // Solid in the middle (vertex 0), gone at the rim.
    for (let i = 1; i < pos.count; i++) colors[i * 4 + 3] = 0;
    this.geo.setAttribute('color', new THREE.BufferAttribute(colors, 4));
    this.clear = sky === 'night' ? 0.12 : 0.85;
    this.mat = new THREE.MeshBasicMaterial({
      map: this.tex,
      vertexColors: true,
      transparent: true,
      opacity: this.clear,
      depthWrite: false,
      fog: false,
      side: THREE.DoubleSide,
      color: sky === 'night' ? '#3a4152' : sky === 'dusk' ? '#ffc9a3' : '#ffffff',
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -0.5;
  }

  update(camera: THREE.Vector3, wetness: number, dt: number): void {
    this.mesh.position.set(camera.x, camera.y + CLOUD_HEIGHT, camera.z);
    this.tex.offset.x += CLOUD_DRIFT * dt;
    this.tex.offset.y += CLOUD_DRIFT * 0.4 * dt;
    // Heavier and greyer as it gets wet (only touched when that changes).
    const o = Math.min(1, this.clear + wetness * 0.5);
    if (this.mat.opacity !== o) this.mat.opacity = o;
  }

  dispose(): void {
    this.tex.dispose();
    this.geo.dispose();
    this.mat.dispose();
  }
}

/** Where marbles lie: off the line on the outside of corners, a share of them per lap. */
export function marbleCount(amount: number, max: number): number {
  return Math.floor(Math.max(0, Math.min(1, amount)) * max);
}

const MAX_MARBLES = 900;

/** Bits of rubber gathering off the racing line: more of the same fixed dots shown as the race goes on. */
export class Marbles3d {
  readonly mesh: THREE.Points;
  private readonly geo = new THREE.BufferGeometry();
  private readonly mat = new THREE.PointsMaterial({ color: '#17171a', size: 0.13 });
  private count = 0;
  private shown = -1;

  constructor(track: Track, heightAt: (x: number, y: number) => number) {
    const n = track.samples.length;
    const v: number[] = [];
    let seed = 11;
    const rnd = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    // Random order, so a growing share spreads over every corner at once.
    const order = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    for (let pass = 0; pass < 4 && v.length < MAX_MARBLES * 3; pass++) {
      for (const i of order) {
        const s = track.samples[i];
        if (Math.abs(s.curvature) < 1 / 110) continue;
        // Outside of the corner, within 3 m of the edge. Curvature + = turning right; + d = right.
        const side = s.curvature > 0 ? -1 : 1;
        const d = side * (s.halfWidth - 0.4 - rnd() * 3);
        const x = s.x + s.nx * d + s.tx * rnd() * 2;
        const y = s.y + s.ny * d + s.ty * rnd() * 2;
        v.push(x, heightAt(s.x, s.y) + 0.04, y);
        if (v.length >= MAX_MARBLES * 3) break;
      }
    }
    this.count = v.length / 3;
    this.geo.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    this.geo.setDrawRange(0, 0);
    this.mesh = new THREE.Points(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  /** How much of the rubber is down (0-1). */
  setAmount(amount: number): void {
    const n = marbleCount(amount, this.count);
    if (n === this.shown) return;
    this.shown = n;
    this.geo.setDrawRange(0, n);
    this.mesh.visible = n > 0;
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
  }
}
