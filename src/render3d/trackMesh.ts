import * as THREE from 'three';
import { KERB_WIDTH, PIT_WALL_OFFSET, type Track, type TrackSample } from '../track/track';
import type { SurfaceType } from '../track/types';

/**
 * The track as 3D geometry, built once from the same centreline samples the physics uses:
 * the walls stand exactly where the cars hit them. Simulation (x, y) is three.js (x, z), with
 * y up. Every layer of ground is a separate band across the track (no layer sits on top of
 * another), so far-away ground never flickers.
 */

const COLORS = {
  outside: '#2d5428',
  grass: '#3f7a35',
  grassStripe: '#468540',
  gravel: '#c9b483',
  runoff: '#5a6670',
  asphalt: '#4a4b50',
  pit: '#5b5c62',
  line: '#ececec',
  kerbRed: '#d22b2b',
  kerbWhite: '#f2f2f2',
  concrete: '#c9ced3',
  concreteAlt: '#9ea6ae',
  armco: '#aeb6bd',
  tyres: '#1b1b1b',
  tyreBand: '#d22b2b',
  pitWall: '#e6e8ea',
  drsDetect: '#ffd400',
  drsStart: '#2ecc40',
  pitLine: '#ffffff',
};

/** Painted edge line, from this far inside the edge to EDGE_LINE_OUT (m). */
const EDGE_LINE_IN = 0.6;
const EDGE_LINE_OUT = 0.2;
const WALL_HEIGHT = 1.1;
const WALL_THICKNESS = 0.4;
const PIT_WALL_HEIGHT = 1.2;
/** Grass mowing stripes this long along the lap (m). */
const MOW_STRIPE = 12;

type V3 = [number, number, number];

/** Collects coloured quads into one non-indexed geometry (one draw call). */
export class QuadBuilder {
  private readonly pos: number[] = [];
  private readonly col: number[] = [];
  private readonly norm: number[] = [];
  private readonly uv: number[] = [];
  private readonly c = new THREE.Color();

  /** A quad a-b-c-d; `up` gives it a straight-up normal (flat ground). */
  quad(a: V3, b: V3, c: V3, d: V3, color: string | THREE.Color, up = false): void {
    if (typeof color === 'string') this.c.set(color);
    else this.c.copy(color);
    // Ground faces up: wind it anticlockwise seen from above, or it would be lit from below.
    if (up && (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]) < 0) [b, d] = [d, b];
    let nx = 0;
    let ny = 1;
    let nz = 0;
    if (!up) {
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
      const vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
      nx = uy * vz - uz * vy;
      ny = uz * vx - ux * vz;
      nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len;
      ny /= len;
      nz /= len;
    }
    for (const p of [a, b, c, a, c, d]) {
      this.pos.push(p[0], p[1], p[2]);
      this.col.push(this.c.r, this.c.g, this.c.b);
      this.norm.push(nx, ny, nz);
      // Planar texture coordinates for the ground noise.
      this.uv.push(p[0] / 6, p[2] / 6);
    }
  }

  /** A box from its 8 corners: bottom a b c d, top e f g h (same order). */
  box(bottom: [V3, V3, V3, V3], top: [V3, V3, V3, V3], color: string | THREE.Color, sides = true): void {
    const [a, b, c, d] = bottom;
    const [e, f, g, h] = top;
    this.quad(e, f, g, h, color);
    if (!sides) return;
    this.quad(a, b, f, e, color);
    this.quad(b, c, g, f, color);
    this.quad(c, d, h, g, color);
    this.quad(d, a, e, h, color);
  }

  get empty(): boolean {
    return this.pos.length === 0;
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.norm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.computeBoundingSphere();
    return g;
  }
}

/** A point `off` metres to the right of a sample (left if negative), at height h. */
export function at(s: TrackSample, off: number, h = 0, along = 0): V3 {
  return [s.x + s.nx * off + s.tx * along, h, s.y + s.ny * off + s.ty * along];
}

/** Ground band between two offsets, from sample a (at height ea) to sample b (at eb). */
function band(q: QuadBuilder, a: TrackSample, b: TrackSample, a0: number, a1: number, b0: number, b1: number, color: string | THREE.Color, ea = 0, eb = 0): void {
  q.quad(at(a, a0, ea), at(b, b0, eb), at(b, b1, eb), at(a, a1, ea), color, true);
}

function runoffColor(surface: SurfaceType, s: number, look: GroundLook): string {
  if (surface === 'gravel') return COLORS.gravel;
  if (surface === 'asphalt' || surface === 'pit') return COLORS.runoff;
  return Math.floor(s / MOW_STRIPE) % 2 === 0 ? look.grass : look.grassStripe;
}

/** Grass colours (desert circuits have sand). */
export interface GroundLook {
  grass: string;
  grassStripe: string;
}

/** Road heights per sample (a bridge where the track crosses itself), and where it's a deck. */
export interface RoadHeights {
  heights: Float32Array;
  deck: Uint8Array;
}

/** Barrier look by what's in front of it: tyre walls behind gravel, armco by grass, else concrete. */
function wallColor(surface: SurfaceType, s: number): string {
  if (surface === 'gravel') return COLORS.tyres;
  if (surface === 'grass') return COLORS.armco;
  return Math.floor(s / 8) % 2 === 0 ? COLORS.concrete : COLORS.concreteAlt;
}

export interface TrackMeshes {
  ground: THREE.BufferGeometry;
  walls: THREE.BufferGeometry;
  /** Painted on the road (start line, DRS lines): drawn over it. */
  paint: THREE.BufferGeometry;
}

export function buildTrackMeshes(track: Track, look: GroundLook = COLORS, elev: RoadHeights | null = null): TrackMeshes {
  const ground = new QuadBuilder();
  const walls = new QuadBuilder();
  const paint = new QuadBuilder();
  const ss = track.samples;
  const n = ss.length;
  const pitSide = track.pit?.side ?? 0;

  for (let i = 0; i < n; i++) {
    const a = ss[i];
    const b = ss[(i + 1) % n];
    const ha = a.halfWidth;
    const hb = b.halfWidth;
    const ea = elev?.heights[i] ?? 0;
    const eb = elev?.heights[(i + 1) % n] ?? 0;
    // On a bridge deck the walls are parapets with open space below; on an embankment they reach the ground.
    const deck = !!elev?.deck[i];
    const raised = ea > 0.05 || eb > 0.05;
    // Road: the middle, then per side the edge line and the strip outside it.
    band(ground, a, b, -(ha - EDGE_LINE_IN), ha - EDGE_LINE_IN, -(hb - EDGE_LINE_IN), hb - EDGE_LINE_IN, COLORS.asphalt, ea, eb);
    for (const side of [1, -1] as const) {
      const r = side === 1;
      band(ground, a, b, side * (ha - EDGE_LINE_IN), side * (ha - EDGE_LINE_OUT), side * (hb - EDGE_LINE_IN), side * (hb - EDGE_LINE_OUT), COLORS.line, ea, eb);
      band(ground, a, b, side * (ha - EDGE_LINE_OUT), side * ha, side * (hb - EDGE_LINE_OUT), side * hb, COLORS.asphalt, ea, eb);

      // Outside the edge: pit lane surface, or a kerb, then run-off up to the wall.
      let ca = ha;
      let cb = hb;
      const pit = side === pitSide && (a.pitWidth > 0 || b.pitWidth > 0);
      if (pit) {
        ca = ha + a.pitWidth;
        cb = hb + b.pitWidth;
        band(ground, a, b, side * ha, side * ca, side * hb, side * cb, COLORS.pit, ea, eb);
      } else if (r ? a.kerbR : a.kerbL) {
        ca = ha + KERB_WIDTH;
        cb = hb + KERB_WIDTH;
        const color = Math.floor(a.s / 2) % 2 === 0 ? COLORS.kerbRed : COLORS.kerbWhite;
        band(ground, a, b, side * ha, side * ca, side * hb, side * cb, color, ea, eb);
      }
      const wa = Math.max(r ? a.wallR : a.wallL, ca);
      const wb = Math.max(r ? b.wallR : b.wallL, cb);
      const surface = r ? a.surfR : a.surfL;
      if (wa > ca + 0.01 || wb > cb + 0.01) band(ground, a, b, side * ca, side * wa, side * cb, side * wb, runoffColor(surface, a.s, look), ea, eb);

      // The wall: its face, its top, and a coloured band on tyre walls.
      const color = raised ? COLORS.concrete : wallColor(surface, a.s);
      const ta = wa + WALL_THICKNESS;
      const tb = wb + WALL_THICKNESS;
      const ba = deck ? ea - 1 : 0;
      const bb = deck ? eb - 1 : 0;
      walls.quad(at(a, side * wa, ba), at(b, side * wb, bb), at(b, side * wb, eb + WALL_HEIGHT), at(a, side * wa, ea + WALL_HEIGHT), color);
      walls.quad(at(a, side * wa, ea + WALL_HEIGHT), at(b, side * wb, eb + WALL_HEIGHT), at(b, side * tb, eb + WALL_HEIGHT), at(a, side * ta, ea + WALL_HEIGHT), color);
      // An embankment's outer face, down to the ground.
      if (raised && !deck) walls.quad(at(a, side * ta, 0), at(b, side * tb, 0), at(b, side * tb, eb + WALL_HEIGHT), at(a, side * ta, ea + WALL_HEIGHT), '#b4b9be');
      if (surface === 'gravel' && !raised && Math.floor(a.s / 4) % 2 === 0) {
        const off = 0.02;
        walls.quad(at(a, side * (wa - off), 0.75), at(b, side * (wb - off), 0.75), at(b, side * (wb - off), 0.95), at(a, side * (wa - off), 0.95), COLORS.tyreBand);
      }
    }
    // Underside of the bridge deck.
    if (deck) {
      walls.quad(at(a, -(a.wallL + WALL_THICKNESS), ea - 1), at(b, -(b.wallL + WALL_THICKNESS), eb - 1), at(b, b.wallR + WALL_THICKNESS, eb - 1), at(a, a.wallR + WALL_THICKNESS, ea - 1), '#8d9399');
    }

    // Pit wall between the track and the lane.
    if (pitSide !== 0 && a.pitWall && b.pitWall) {
      const oa = ha + PIT_WALL_OFFSET;
      const ob = hb + PIT_WALL_OFFSET;
      const t = 0.3;
      walls.box(
        [at(a, pitSide * (oa - t / 2)), at(b, pitSide * (ob - t / 2)), at(b, pitSide * (ob + t / 2)), at(a, pitSide * (oa + t / 2))],
        [at(a, pitSide * (oa - t / 2), PIT_WALL_HEIGHT), at(b, pitSide * (ob - t / 2), PIT_WALL_HEIGHT), at(b, pitSide * (ob + t / 2), PIT_WALL_HEIGHT), at(a, pitSide * (oa + t / 2), PIT_WALL_HEIGHT)],
        COLORS.pitWall,
      );
    }
  }

  // Chequered start/finish line.
  const s0 = ss[0];
  const squares = 14;
  const size = (s0.halfWidth * 2) / squares;
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < squares; col++) {
      const off = -s0.halfWidth + col * size;
      const along = (row - 1) * size;
      const color = (row + col) % 2 === 0 ? '#ffffff' : '#111111';
      paint.quad(at(s0, off, 0, along), at(s0, off, 0, along + size), at(s0, off + size, 0, along + size), at(s0, off + size, 0, along), color, true);
    }
  }
  // DRS detection (yellow) and activation (green) lines across the track.
  const across = (lap: number, color: string) => {
    const s = ss[Math.floor(lap / 2) % n];
    paint.quad(at(s, -s.halfWidth, 0, -0.3), at(s, -s.halfWidth, 0, 0.3), at(s, s.halfWidth, 0, 0.3), at(s, s.halfWidth, 0, -0.3), color, true);
  };
  for (const zone of track.drsZones) {
    across(zone.detect, COLORS.drsDetect);
    across(zone.start, COLORS.drsStart);
  }
  // Pit entry and exit lines across the lane.
  if (track.pit) {
    for (const lap of [track.pit.entry, track.pit.exit]) {
      const s = ss[Math.floor(lap / 2) % n];
      const side = track.pit.side;
      const w = s.halfWidth + Math.max(s.pitWidth, 2);
      paint.quad(at(s, side * s.halfWidth, 0, -0.25), at(s, side * s.halfWidth, 0, 0.25), at(s, side * w, 0, 0.25), at(s, side * w, 0, -0.25), COLORS.pitLine, true);
    }
  }

  return { ground: ground.build(), walls: walls.build(), paint: paint.build() };
}

/** Grey noise, multiplied over the ground so asphalt and grass show movement at speed. */
export function noiseTexture(): THREE.Texture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  let seed = 1234567;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < size * size; i++) {
    const v = 205 + rnd() * 50;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export { COLORS as TRACK_COLORS };
