import * as THREE from 'three';
import type { Track, TrackSample } from '../track/track';

/**
 * The land around the track in 3D: a height grid that follows the track's real ground heights
 * near it and levels out to the average further away. Never above the road beside it (the road
 * sits on it) and below any water. Only looks: the physics never sees it.
 */

/** Grid cell (m), how far the land reaches past the track (m), and how far heights blend (m). */
const CELL = 20;
const MARGIN = 1300;
const BLEND = 160;

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
          // Beside the track: just under its road (its ground, not a bridge over it).
          const hit = track.query(x, y);
          if (hit) {
            const wall = hit.d >= 0 ? hit.sample.wallR : hit.sample.wallL;
            if (Math.abs(hit.d) < wall + 8) h = Math.min(h, hit.sample.ground - 0.15);
          }
        }
        const water = waterAt(x, y);
        if (water !== null) h = Math.min(h, water - 1.5);
        this.heights[r * this.cols + c] = h - 0.12;
      }
    }
  }

  /** Height of the land at a point (bilinear in the grid). */
  heightAt(x: number, y: number): number {
    const fx = Math.max(0, Math.min(this.cols - 1.001, (x - this.minX) / CELL));
    const fy = Math.max(0, Math.min(this.rows - 1.001, (y - this.minY) / CELL));
    const c = Math.floor(fx);
    const r = Math.floor(fy);
    const tx = fx - c;
    const ty = fy - r;
    const h = (cc: number, rr: number) => this.heights[rr * this.cols + cc];
    return (h(c, r) * (1 - tx) + h(c + 1, r) * tx) * (1 - ty) + (h(c, r + 1) * (1 - tx) + h(c + 1, r + 1) * tx) * ty;
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
