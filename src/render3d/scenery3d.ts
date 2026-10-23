import * as THREE from 'three';
import type { Track, TrackSample } from '../track/track';
import { findBrakeBoards } from '../render/trackGraphics';
import { at, QuadBuilder } from './trackMesh';

/**
 * Static 3D scenery, built once per track: trees (instanced, so thousands of them are a
 * couple of draw calls), grandstands with a crowd, pit garages, brake boards, the start
 * gantry and hills on the horizon. Everything stays clear of the walls of every part of the
 * track. Nothing moves.
 */

const TREE_STEP = 8;
const TREE_REACH = 220;
const STAND_GAP = 5;
const STAND_ROWS = 10;
const STADIUM_ROWS = 22;
const ROW_DEPTH = 1.1;
const ROW_RISE = 0.55;
const MAX_CORNER_STANDS = 4;
const CORNER_STAND_SPACING = 400;
const SEATS = ['#2f5fa8', '#a83232', '#6d6f73', '#2f8a5a', '#c48a1c'];
const CROWD = ['#e8e8e8', '#d22b2b', '#ff8a00', '#1f5fd1', '#f2d22e', '#1b1b1b', '#27a35a', '#c48a6a'];

function rng(seed: number): () => number {
  let s = seed % 2147483647 || 1;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

export interface SceneryOptions {
  /** Trees per spot compared with normal. */
  trees: number;
  /** Places kept clear for landmarks (water, buildings). */
  blocked: (x: number, y: number, margin: number) => boolean;
  /** Colour of the hills on the horizon, and whether they're mountains (the Alps). */
  hills: string;
  alps?: boolean;
  /** Height of the road near a point (boards on a bridge ramp stand up with it). */
  heightAt?: (x: number, y: number) => number;
  /** Height of the land (trees stand on it), and its average (the horizon hills). */
  groundAt?: (x: number, y: number) => number;
  base?: number;
}

export class Scenery3d {
  readonly group = new THREE.Group();
  private readonly rnd: () => number;
  private readonly ss: TrackSample[];
  private readonly solid = new QuadBuilder();

  constructor(
    private readonly track: Track,
    material: THREE.Material,
    private readonly opts: SceneryOptions = { trees: 1, blocked: () => false, hills: '#5d7a8a' },
  ) {
    this.rnd = rng(hash(track.name));
    this.ss = track.samples;
    this.addGarages();
    this.addStadiums();
    this.addMainStands();
    this.addCornerStands();
    this.addGantry();
    if (!this.solid.empty) this.group.add(new THREE.Mesh(this.solid.build(), material));
    this.addTrees();
    this.addBoards();
    this.addHills();
  }

  /** At least `margin` metres beyond the walls of whichever part of the track is nearest. */
  private clear(x: number, y: number, margin: number): boolean {
    if (this.opts.blocked(x, y, margin)) return false;
    const hit = this.track.query(x, y);
    if (!hit) return true;
    const wall = hit.d >= 0 ? hit.sample.wallR : hit.sample.wallL;
    return Math.abs(hit.d) - wall > margin;
  }

  /** Stadium sections (Mexico's Foro Sol): tall stands on both sides. */
  private addStadiums(): void {
    const n = this.ss.length;
    for (const l of this.track.scenery?.landmarks ?? []) {
      if (l.type !== 'stadium') continue;
      const i0 = Math.floor((l.from ?? 0) * n);
      const len = (((Math.floor((l.to ?? 0) * n) - i0) % n) + n) % n;
      for (const side of [1, -1] as const) this.stand(i0, i0 + len, side, STADIUM_ROWS);
    }
  }

  private sample(i: number): TrackSample {
    const n = this.ss.length;
    return this.ss[((i % n) + n) % n];
  }

  private wall(s: TrackSample, side: 1 | -1): number {
    return side === 1 ? s.wallR : s.wallL;
  }

  /** A stepped grandstand along samples [i0, i1] on one side, cut short where it isn't clear. */
  private stand(i0: number, i1: number, side: 1 | -1, rows = STAND_ROWS): boolean {
    const depth = rows * ROW_DEPTH;
    const ok = (s: TrackSample) => {
      const base = this.wall(s, side) + STAND_GAP;
      const p = at(s, side * base);
      const q = at(s, side * (base + depth + 2));
      return this.clear(p[0], p[2], STAND_GAP - 1) && this.clear(q[0], q[2], STAND_GAP - 1);
    };
    const seat = SEATS[Math.floor(this.rnd() * SEATS.length)];
    let built = 0;
    for (let i = i0; i < i1; i++) {
      const a = this.sample(i);
      const b = this.sample(i + 1);
      if (!ok(a) || !ok(b)) continue;
      built++;
      const ba = this.wall(a, side) + STAND_GAP;
      const bb = this.wall(b, side) + STAND_GAP;
      const q = this.solid;
      for (let r = 0; r < rows; r++) {
        const h0 = 0.8 + r * ROW_RISE;
        const h1 = h0 + ROW_RISE;
        const da0 = side * (ba + r * ROW_DEPTH);
        const da1 = side * (ba + (r + 1) * ROW_DEPTH);
        const db0 = side * (bb + r * ROW_DEPTH);
        const db1 = side * (bb + (r + 1) * ROW_DEPTH);
        // Riser, then the row: mostly crowd, some empty seats.
        q.quad(at(a, da0, h0), at(b, db0, h0), at(b, db0, h1), at(a, da0, h1), seat);
        const full = this.rnd() < 0.8;
        q.quad(at(a, da0, h1), at(b, db0, h1), at(b, db1, h1), at(a, da1, h1), full ? CROWD[Math.floor(this.rnd() * CROWD.length)] : seat);
        if (full) {
          // Heads: a little block on the row.
          const m = 0.25 + this.rnd() * 0.5;
          const lerp = (s: TrackSample, off: number, h: number): [number, number, number] => at(s, off, h);
          const c = CROWD[Math.floor(this.rnd() * CROWD.length)];
          const pa = side * (ba + (r + 0.3) * ROW_DEPTH);
          const pb = side * (bb + (r + 0.3) * ROW_DEPTH);
          q.quad(lerp(a, pa, h1), lerp(b, pb, h1), lerp(b, pb, h1 + m), lerp(a, pa, h1 + m), c);
        }
      }
      // Front wall, back wall and roof.
      const top = 0.8 + rows * ROW_RISE;
      q.quad(at(a, side * ba, 0), at(b, side * bb, 0), at(b, side * bb, 0.8), at(a, side * ba, 0.8), '#4f555c');
      q.quad(at(a, side * (ba + depth), 0), at(b, side * (bb + depth), 0), at(b, side * (bb + depth), top + 3), at(a, side * (ba + depth), top + 3), '#4f555c');
      q.quad(at(a, side * (ba - 1), top + 3.2), at(b, side * (bb - 1), top + 3.2), at(b, side * (bb + depth), top + 3), at(a, side * (ba + depth), top + 3), '#c9ced3');
    }
    return built > 5;
  }

  /** Grandstands along the main straight, opposite the pits. */
  private addMainStands(): void {
    const side = (this.track.pit ? -this.track.pit.side : 1) as 1 | -1;
    this.stand(-110, 50, side);
  }

  /** Grandstands round the outside of the big braking zones. */
  private addCornerStands(): void {
    const ss = this.ss;
    const n = ss.length;
    const tight = (i: number) => Math.abs(this.sample(i).curvature) >= 1 / 80;
    const fast = (i: number) => Math.abs(this.sample(i).curvature) < 1 / 150;
    const placed: number[] = [0];
    for (let i = 0; i < n && placed.length <= MAX_CORNER_STANDS; i++) {
      if (!tight(i) || tight(i - 1)) continue;
      let approach = true;
      for (let j = 8; j <= 30; j++) if (!fast(i - j)) approach = false;
      if (!approach) continue;
      if (placed.some((p) => this.track.forwardDistance(p * 2, i * 2) < CORNER_STAND_SPACING && this.track.forwardDistance(i * 2, p * 2) < CORNER_STAND_SPACING)) continue;
      // Outside of the corner: a right-hander (positive curvature) has its outside on the left.
      const side = (ss[(i + 5) % n].curvature > 0 ? -1 : 1) as 1 | -1;
      if (this.stand(i - 30, i + 15, side)) placed.push(i);
    }
  }

  /** Pit garages behind the pit lane. */
  private addGarages(): void {
    const pit = this.track.pit;
    if (!pit) return;
    const side = pit.side;
    const n = this.ss.length;
    const start = Math.floor(pit.wallStart / 2);
    const len = Math.floor(this.track.forwardDistance(pit.wallStart, pit.wallEnd) / 2);
    const q = this.solid;
    const depth = 14;
    const height = 7;
    for (let k = 0; k < len; k++) {
      const a = this.ss[(start + k) % n];
      const b = this.ss[(start + k + 1) % n];
      const ba = this.wall(a, side) + 1.5;
      const bb = this.wall(b, side) + 1.5;
      const pa = at(a, side * (ba + depth));
      if (!this.clear(pa[0], pa[2], 1) || !this.clear(...xz(at(a, side * ba)), 1)) continue;
      // Doors 4 m wide with a 2 m pillar between.
      const door = (a.s % 6) < 4;
      q.quad(at(a, side * ba, 0), at(b, side * bb, 0), at(b, side * bb, height), at(a, side * ba, height), '#8d939a');
      if (door) {
        const o = 0.03;
        q.quad(at(a, side * (ba - o), 0), at(b, side * (bb - o), 0), at(b, side * (bb - o), 4.2), at(a, side * (ba - o), 4.2), '#2e3237');
      }
      q.quad(at(a, side * ba, height), at(b, side * bb, height), at(b, side * (bb + depth), height), at(a, side * (ba + depth), height), '#b5bac0');
    }
  }

  /** The start-light gantry over the start line. */
  private addGantry(): void {
    const s = this.ss[3];
    const q = this.solid;
    const w = s.halfWidth + 1.5;
    const post = (off: number) =>
      q.box(
        [at(s, off - 0.3, 0, -0.3), at(s, off - 0.3, 0, 0.3), at(s, off + 0.3, 0, 0.3), at(s, off + 0.3, 0, -0.3)],
        [at(s, off - 0.3, 8, -0.3), at(s, off - 0.3, 8, 0.3), at(s, off + 0.3, 8, 0.3), at(s, off + 0.3, 8, -0.3)],
        '#3a3d42',
      );
    post(-w);
    post(w);
    q.box(
      [at(s, -w, 6.6, -0.5), at(s, -w, 6.6, 0.5), at(s, w, 6.6, 0.5), at(s, w, 6.6, -0.5)],
      [at(s, -w, 8, -0.5), at(s, -w, 8, 0.5), at(s, w, 8, 0.5), at(s, w, 8, -0.5)],
      '#24272b',
    );
    // Five light pods facing the grid.
    for (let k = 0; k < 5; k++) {
      const off = (k - 2) * 1.6;
      q.quad(at(s, off - 0.5, 6.3, -0.55), at(s, off + 0.5, 6.3, -0.55), at(s, off + 0.5, 7.9, -0.55), at(s, off - 0.5, 7.9, -0.55), '#111111');
    }
  }

  private addTrees(): void {
    const spots: { x: number; y: number; s: number; tone: number }[] = [];
    const step = Math.round(TREE_STEP / 2);
    for (let i = 0; i < this.ss.length; i += step) {
      const t = this.ss[i];
      for (const side of [1, -1] as const) {
        // Fewer trees in the desert, more in a forest.
        const count = Math.floor((1 + this.rnd() * 3) * this.opts.trees);
        for (let k = 0; k < count; k++) {
          // Denser near the track.
          const out = this.wall(t, side) + 9 + Math.pow(this.rnd(), 1.6) * TREE_REACH;
          const along = (this.rnd() - 0.5) * TREE_STEP;
          const p = at(t, side * out, 0, along);
          if (!this.clear(p[0], p[2], 7)) continue;
          spots.push({ x: p[0], y: p[2], s: 0.7 + this.rnd() * 0.7, tone: this.rnd() });
        }
      }
    }
    if (spots.length === 0) return;
    const pines = spots.filter((_, k) => k % 3 !== 0);
    const rounds = spots.filter((_, k) => k % 3 === 0);
    const trunk = new THREE.CylinderGeometry(0.25, 0.35, 3, 5);
    trunk.translate(0, 1.5, 0);
    const pine = new THREE.ConeGeometry(2.6, 8, 6);
    pine.translate(0, 6.5, 0);
    const round = new THREE.IcosahedronGeometry(3.2, 0);
    round.translate(0, 5.5, 0);
    const mat = new THREE.MeshLambertMaterial({ flatShading: true });
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    const place = (geo: THREE.BufferGeometry, list: typeof spots, color: (tone: number) => THREE.Color) => {
      const mesh = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((p, k) => {
        m.makeScale(p.s, p.s * (0.85 + p.tone * 0.3), p.s).setPosition(p.x, (this.opts.groundAt?.(p.x, p.y) ?? 0) - 0.2, p.y);
        mesh.setMatrixAt(k, m);
        mesh.setColorAt(k, color(p.tone));
      });
      mesh.computeBoundingSphere();
      this.group.add(mesh);
    };
    place(pine, pines, (t) => c.setHSL(0.3 + t * 0.06, 0.45, 0.2 + t * 0.08));
    place(round, rounds, (t) => c.setHSL(0.22 + t * 0.08, 0.45, 0.26 + t * 0.1));
    place(trunk, spots, () => c.set('#5a4030'));
  }

  /** 100 / 50 m boards before the big braking zones, facing the drivers. */
  private addBoards(): void {
    const boards = findBrakeBoards(this.track);
    if (boards.length === 0) return;
    const textures = new Map<string, THREE.Material>();
    const face = (label: string) => {
      let mat = textures.get(label);
      if (mat) return mat;
      const canvas = document.createElement('canvas');
      canvas.width = 128;
      canvas.height = 96;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, 128, 96);
      ctx.strokeStyle = '#111';
      ctx.lineWidth = 8;
      ctx.strokeRect(4, 4, 120, 88);
      ctx.fillStyle = '#111';
      ctx.font = 'bold 60px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, 64, 52);
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      mat = new THREE.MeshBasicMaterial({ map: tex });
      textures.set(label, mat);
      return mat;
    };
    const plane = new THREE.PlaneGeometry(2, 1.5);
    const postGeo = new THREE.BoxGeometry(0.15, 1.3, 0.15);
    const postMat = new THREE.MeshLambertMaterial({ color: '#777' });
    for (const b of boards) {
      const board = new THREE.Mesh(plane, face(b.label));
      const lift = this.opts.heightAt?.(b.x, b.y) ?? 0;
      board.position.set(b.x, 2 + lift, b.y);
      board.rotation.y = Math.atan2(-b.tx, -b.ty);
      const post = new THREE.Mesh(postGeo, postMat);
      post.position.set(b.x, 0.65 + lift, b.y);
      this.group.add(board, post);
    }
  }

  /** Low hills on the horizon, out past the fog (so not fogged away). */
  private addHills(): void {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const s of this.ss) {
      minX = Math.min(minX, s.x);
      maxX = Math.max(maxX, s.x);
      minY = Math.min(minY, s.y);
      maxY = Math.max(maxY, s.y);
    }
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const radius = Math.hypot(maxX - minX, maxY - minY) / 2 + 900;
    const geo = new THREE.ConeGeometry(1, 1, 5);
    geo.translate(0, 0.5, 0);
    const count = 46;
    const mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ fog: false }), count);
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    for (let k = 0; k < count; k++) {
      const a = (k / count) * Math.PI * 2 + this.rnd() * 0.1;
      const r = radius + this.rnd() * 300;
      const w = 250 + this.rnd() * 350;
      const h = this.opts.alps ? 260 + this.rnd() * 380 : 60 + this.rnd() * 140;
      m.makeScale(w, h, w).setPosition(cx + Math.cos(a) * r, (this.opts.base ?? 0) - 5, cy + Math.sin(a) * r);
      mesh.setMatrixAt(k, m);
      mesh.setColorAt(k, c.set(this.opts.hills).offsetHSL(this.rnd() * 0.06 - 0.03, 0, this.rnd() * 0.08 - 0.04));
    }
    mesh.frustumCulled = false;
    this.group.add(mesh);
  }
}

function xz(p: [number, number, number]): [number, number] {
  return [p[0], p[2]];
}
