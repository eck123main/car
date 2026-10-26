import * as THREE from 'three';
import type { IdealLine } from '../sim/ai/idealLine';
import type { Track } from '../track/track';
import { CUE_COLORS } from '../render/idealLine';

/** Width of the painted line (m) and its height over the road. */
const WIDTH = 0.8;
const LIFT = 0.06;

/**
 * The ideal line painted on the road for the whole lap: green (throttle), yellow (hold the
 * corner), red (brake). One ribbon with vertex colours, one draw call.
 */
export class IdealLine3d {
  readonly mesh: THREE.Mesh;

  constructor(track: Track, ideal: IdealLine) {
    const ss = track.samples;
    const n = ss.length;
    const pos = new Float32Array((n + 1) * 2 * 3);
    const col = new Float32Array((n + 1) * 2 * 3);
    const colors = CUE_COLORS.map((c) => new THREE.Color(c));
    for (let k = 0; k <= n; k++) {
      const i = k % n;
      const s = ss[i];
      const o = ideal.line.offset[i];
      const x = s.x + s.nx * o;
      const y = s.y + s.ny * o;
      const h = s.z + LIFT;
      const c = colors[ideal.cue[i]];
      for (const [side, v] of [
        [-1, 2 * k],
        [1, 2 * k + 1],
      ]) {
        pos.set([x + s.nx * side * (WIDTH / 2), h, y + s.ny * side * (WIDTH / 2)], v * 3);
        col.set([c.r, c.g, c.b], v * 3);
      }
    }
    const index: number[] = [];
    for (let k = 0; k < n; k++) {
      const a = 2 * k;
      index.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(index);
    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.75,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.renderOrder = 1;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
