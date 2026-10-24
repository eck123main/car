import * as THREE from 'three';
import { PIT_WALL_OFFSET, type Track, type TrackSample } from '../track/track';

/**
 * The land around the track in 3D: a height grid that follows the track's real ground heights
 * near it and levels out to the average further away. Never above the road beside it (the road
 * sits on it) and below any water. Only looks: the physics never sees it.
 */

/** Grid cell (m), how far the land reaches past the track (m), and how far heights blend (m). */
const CELL = 20;
const MARGIN = 1300;
const BLEND = 160;
/** Beyond the walls the land eases from the road's height into the blend over this far (m). */
const NEAR = 90;
/** The land stays this far under the road (m), and the track is checked every FOOT_STEP m across. */
const CLEARANCE = 0.3;
const FOOT_STEP = 3;

export class Terrain {
  /** Average ground height round the track: where the land levels out to. */
  readonly base: number;
  private readonly heights: Float32Array;
  private readonly minX: number;
  private readonly minY: number;
  private readonly cols: number;
  private readonly rows: number;
  private readonly flat: boolean;

  constructor(
    track: Track,
    /** Water level at a point, if it's under water (sea, harbour, lake). */
    waterAt: (x: number, y: number) => number | null = () => null,
  ) {
    const ss = track.samples;
    this.base = ss.reduce((s, t) => s + t.ground, 0) / ss.length;
    this.flat = ss.every((s) => s.ground === 0);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const s of ss) {
      minX = Math.min(minX, s.x);
      maxX = Math.max(maxX, s.x);
      minY = Math.min(minY, s.y);
      maxY = Math.max(maxY, s.y);
    }
    this.minX = minX - MARGIN;
    this.minY = minY - MARGIN;
    this.cols = Math.ceil((maxX - minX + 2 * MARGIN) / CELL) + 1;
    this.rows = Math.ceil((maxY - minY + 2 * MARGIN) / CELL) + 1;
    this.heights = new Float32Array(this.cols * this.rows);

    // Samples bucketed for the blend.
    const bucket = new Map<string, TrackSample[]>();
    const key = (bx: number, by: number) => `${bx},${by}`;
    for (let i = 0; i < ss.length; i += 2) {
      const s = ss[i];
      const k = key(Math.floor(s.x / BLEND), Math.floor(s.y / BLEND));
      let list = bucket.get(k);
      if (!list) bucket.set(k, (list = []));
      list.push(s);
    }
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const x = this.minX + c * CELL;
        const y = this.minY + r * CELL;
        let h = this.base;
        if (!this.flat) {
          // Inverse-distance blend of nearby ground heights, fading to the average.
          let sum = this.base / (BLEND * BLEND);
          let wsum = 1 / (BLEND * BLEND);
          const bx = Math.floor(x / BLEND);
          const by = Math.floor(y / BLEND);
          for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
              for (const s of bucket.get(key(bx + dx, by + dy)) ?? []) {
                const d2 = (s.x - x) ** 2 + (s.y - y) ** 2;
                if (d2 > BLEND * BLEND) continue;
                const w = 1 / (d2 + 100);
                sum += w * s.ground;
                wsum += w;
              }
            }
          }
          h = sum / wsum;
          // Beside the track the land meets its road (its ground, not a bridge over it), then
          // eases into the blend further out: no hill rising straight off the run-off.
          const hit = track.query(x, y);
          if (hit) {
            const wall = hit.d >= 0 ? hit.sample.wallR : hit.sample.wallL;
            const t = Math.max(0, Math.min(1, (Math.abs(hit.d) - wall) / NEAR));
            h = hit.sample.ground + (h - hit.sample.ground) * t * t * (3 - 2 * t);
          }
        }
        const water = waterAt(x, y);
        if (water !== null) h = Math.min(h, water - 1.5);
        this.heights[r * this.cols + c] = h - 0.12;
      }
    }
    if (!this.flat) this.keepUnderRoad(track);
  }

  /**
   * Push the land under everything the track lays on it: road, kerbs, run-off, pit lane and
   * the walls. A grid cell's land never rises above its highest corner, so every corner of
   * every cell the track touches goes below the lowest road in that cell. Bridge decks are
   * skipped (the land runs underneath).
   */
  private keepUnderRoad(track: Track): void {
    const lowest = new Map<number, number>();
    const mark = (x: number, y: number, z: number) => {
      const c = Math.floor((x - this.minX) / CELL);
      const r = Math.floor((y - this.minY) / CELL);
      if (c < 0 || r < 0 || c >= this.cols - 1 || r >= this.rows - 1) return;
      const k = r * this.cols + c;
      lowest.set(k, Math.min(lowest.get(k) ?? Infinity, z));
    };
    const pitSide = track.pit?.side ?? 0;
    for (const s of track.samples) {
      if (s.deck) continue;
      for (const side of [1, -1] as const) {
        let reach = side === 1 ? s.wallR : s.wallL;
        if (side === pitSide) reach = Math.max(reach, s.halfWidth + s.pitWidth + PIT_WALL_OFFSET);
        reach += 1.5;
        const steps = Math.ceil(reach / FOOT_STEP);
        for (let k = 0; k <= steps; k++) {
          const off = (side * reach * k) / steps;
          mark(s.x + s.nx * off, s.y + s.ny * off, s.ground);
        }
      }
    }
    for (const [k, z] of lowest) {
      for (const j of [k, k + 1, k + this.cols, k + this.cols + 1]) this.heights[j] = Math.min(this.heights[j], z - CLEARANCE);
    }
  }

  /** Height of the land at a point: exactly the drawn surface (two triangles per cell, like PlaneGeometry). */
  heightAt(x: number, y: number): number {
    const fx = Math.max(0, Math.min(this.cols - 1.001, (x - this.minX) / CELL));
    const fy = Math.max(0, Math.min(this.rows - 1.001, (y - this.minY) / CELL));
    const c = Math.floor(fx);
    const r = Math.floor(fy);
    const tx = fx - c;
    const ty = fy - r;
    const h = (cc: number, rr: number) => this.heights[rr * this.cols + cc];
    // Split along the diagonal from (c + 1, r) to (c, r + 1).
    if (tx + ty <= 1) return h(c, r) + (h(c + 1, r) - h(c, r)) * tx + (h(c, r + 1) - h(c, r)) * ty;
    return h(c + 1, r + 1) + (h(c, r + 1) - h(c + 1, r + 1)) * (1 - tx) + (h(c + 1, r) - h(c + 1, r + 1)) * (1 - ty);
  }

  /**
   * A flat plain round the land grid out to the horizon, at the grid's edge height. A frame,
   * not a full plane: a plane under everything would cut through any road lower than the
   * average (Eau Rouge) and bury it.
   */
  outskirts(reach = 6000): THREE.BufferGeometry {
    const h = this.base - 0.12;
    const x0 = this.minX;
    const y0 = this.minY;
    const x1 = this.minX + (this.cols - 1) * CELL;
    const y1 = this.minY + (this.rows - 1) * CELL;
    const X0 = x0 - reach, X1 = x1 + reach, Y0 = y0 - reach, Y1 = y1 + reach;
    // Four strips: north and south full width, west and east between them. Wound to face up.
    const rects = [
      [X0, Y0, X1, y0],
      [X0, y1, X1, Y1],
      [X0, y0, x0, y1],
      [x1, y0, X1, y1],
    ];
    const pos: number[] = [];
    for (const [ax, ay, bx, by] of rects) pos.push(ax, h, ay, ax, h, by, bx, h, by, ax, h, ay, bx, h, by, bx, h, ay);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    return geo;
  }

  /** The land as one mesh: a grid, coloured by the caller's material. */
  geometry(): THREE.BufferGeometry {
    const geo = new THREE.PlaneGeometry((this.cols - 1) * CELL, (this.rows - 1) * CELL, this.cols - 1, this.rows - 1);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.getAttribute('position');
    const uv = geo.getAttribute('uv');
    const cx = this.minX + ((this.cols - 1) * CELL) / 2;
    const cy = this.minY + ((this.rows - 1) * CELL) / 2;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) + cx;
      const y = pos.getZ(i) + cy;
      pos.setXYZ(i, x, this.heightAt(x, y), y);
      // Planar texture coordinates for the ground noise, like the track.
      uv.setXY(i, x / 6, y / 6);
    }
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    return geo;
  }
}
