import * as THREE from 'three';
import type { Rgb } from '../../sim/openRoad/biomes';
import type { Land } from '../../sim/openRoad/land';

/** Cells along a tile's side. */
const CELLS = 32;
/** Biggest and smallest tile (m): a cell is 1/32 of that, so 200 m down to 6.25 m. */
const ROOT = 6400;
const LEAF = 200;
/** A tile splits in four when the camera is closer than this many of its sizes. */
const SPLIT = 0.8;
/** Land is drawn this far out (m); fog has it all by then. */
const FAR = 15000;
/** Texture repeats every this many metres. */
const UV_SIZE = 48;

interface Tile {
  key: string;
  size: number;
  ix: number;
  iy: number;
  mesh: THREE.Mesh | null;
  used: number;
}

/** A grid's triangles, shared by every tile, skirts included. */
function tileIndex(): THREE.BufferAttribute {
  const v = CELLS + 1;
  const out: number[] = [];
  const at = (i: number, j: number) => j * v + i;
  for (let j = 0; j < CELLS; j++) {
    for (let i = 0; i < CELLS; i++) {
      const a = at(i, j);
      const b = at(i + 1, j);
      const c = at(i, j + 1);
      const d = at(i + 1, j + 1);
      // Facing up, with x and z as sim x and y.
      if ((i + j) % 2 === 0) out.push(a, c, b, b, c, d);
      else out.push(a, c, d, a, d, b);
    }
  }
  // Skirts: a curtain hanging from each edge hides the cracks between tile sizes.
  const edge: number[] = [];
  for (let i = 0; i <= CELLS; i++) edge.push(at(i, 0));
  for (let j = 1; j <= CELLS; j++) edge.push(at(CELLS, j));
  for (let i = CELLS - 1; i >= 0; i--) edge.push(at(i, CELLS));
  for (let j = CELLS - 1; j >= 1; j--) edge.push(at(0, j));
  const base = v * v;
  for (let k = 0; k < edge.length; k++) {
    const a = edge[k];
    const b = edge[(k + 1) % edge.length];
    const sa = base + k;
    const sb = base + ((k + 1) % edge.length);
    out.push(a, b, sa, b, sb, sa);
  }
  return new THREE.BufferAttribute(new Uint16Array(out), 1);
}

export const SKIRT_VERTS = CELLS * 4;

/**
 * The land round the camera as a quadtree of tiles, finer the closer they are. Tiles are made a few
 * per frame, nearest first; until a part's fine tiles are ready its coarser one stays on show.
 */
export class TerrainTiles {
  readonly group = new THREE.Group();
  private readonly tiles = new Map<string, Tile>();
  private readonly index = tileIndex();
  private stamp = 0;
  private wanted: { tile: Tile; dist: number }[] = [];
  private camX = NaN;
  private camY = NaN;
  private dirty = true;
  /** Tiles still to make right now. */
  pending = 1;
  private readonly heights = new Float64Array((CELLS + 3) * (CELLS + 3));
  private readonly color: Rgb = [0, 0, 0];

  constructor(
    private readonly land: Land,
    private readonly material: THREE.Material,
  ) {}

  /** Call each frame: moves the detail with the camera and makes tiles for up to `budget` ms. */
  update(x: number, y: number, budget: number): void {
    if (!(Math.hypot(x - this.camX, y - this.camY) <= 12)) {
      this.camX = x;
      this.camY = y;
      this.dirty = true;
    }
    if (this.dirty) this.refresh();
    const start = performance.now();
    while (this.wanted.length > 0) {
      const next = this.wanted.pop()!;
      if (!next.tile.mesh) this.build(next.tile);
      this.dirty = true;
      this.pending = this.wanted.length;
      if (performance.now() - start > budget) break;
    }
    this.pending = this.wanted.length;
  }

  /** Work out which tiles should be showing and queue the missing ones. */
  private refresh(): void {
    this.dirty = false;
    this.stamp++;
    this.wanted = [];
    for (const t of this.tiles.values()) if (t.mesh) t.mesh.visible = false;
    const r = Math.ceil(FAR / ROOT);
    const cx = Math.floor(this.camX / ROOT);
    const cy = Math.floor(this.camY / ROOT);
    for (let iy = cy - r; iy <= cy + r; iy++) {
      for (let ix = cx - r; ix <= cx + r; ix++) {
        if (this.boxDist(ROOT, ix, iy) > FAR) continue;
        this.show(ROOT, ix, iy);
      }
    }
    // Furthest first: popped off the end, so the nearest is made first.
    this.wanted.sort((a, b) => b.dist - a.dist);
    for (const [key, t] of this.tiles) {
      if (this.stamp - t.used > 40) {
        if (t.mesh) {
          t.mesh.geometry.dispose();
          t.mesh.removeFromParent();
        }
        this.tiles.delete(key);
      }
    }
  }

  private boxDist(size: number, ix: number, iy: number): number {
    const dx = Math.max(ix * size - this.camX, 0, this.camX - (ix + 1) * size);
    const dy = Math.max(iy * size - this.camY, 0, this.camY - (iy + 1) * size);
    return Math.hypot(dx, dy);
  }

  private splits(size: number, ix: number, iy: number): boolean {
    return size > LEAF && this.boxDist(size, ix, iy) < size * SPLIT;
  }

  private tile(size: number, ix: number, iy: number): Tile {
    const key = `${size}:${ix}:${iy}`;
    let t = this.tiles.get(key);
    if (!t) {
      t = { key, size, ix, iy, mesh: null, used: this.stamp };
      this.tiles.set(key, t);
    }
    return t;
  }

  /** Is this area drawn at the wanted detail? */
  private covered(size: number, ix: number, iy: number): boolean {
    if (!this.splits(size, ix, iy)) return !!this.tiles.get(`${size}:${ix}:${iy}`)?.mesh;
    const h = size / 2;
    return this.covered(h, ix * 2, iy * 2) && this.covered(h, ix * 2 + 1, iy * 2) && this.covered(h, ix * 2, iy * 2 + 1) && this.covered(h, ix * 2 + 1, iy * 2 + 1);
  }

  private show(size: number, ix: number, iy: number): void {
    const t = this.tile(size, ix, iy);
    t.used = this.stamp;
    if (!this.splits(size, ix, iy)) {
      if (t.mesh) t.mesh.visible = true;
      else this.wanted.push({ tile: t, dist: this.boxDist(size, ix, iy) });
      return;
    }
    const h = size / 2;
    const children: [number, number][] = [
      [ix * 2, iy * 2],
      [ix * 2 + 1, iy * 2],
      [ix * 2, iy * 2 + 1],
      [ix * 2 + 1, iy * 2 + 1],
    ];
    if (t.mesh && !children.every(([a, b]) => this.covered(h, a, b))) {
      // The finer tiles aren't all ready: keep showing this one, but get them made.
      t.mesh.visible = true;
      for (const [a, b] of children) this.queueOnly(h, a, b);
      return;
    }
    for (const [a, b] of children) this.show(h, a, b);
  }

  private queueOnly(size: number, ix: number, iy: number): void {
    const t = this.tile(size, ix, iy);
    t.used = this.stamp;
    if (this.splits(size, ix, iy)) {
      const h = size / 2;
      this.queueOnly(h, ix * 2, iy * 2);
      this.queueOnly(h, ix * 2 + 1, iy * 2);
      this.queueOnly(h, ix * 2, iy * 2 + 1);
      this.queueOnly(h, ix * 2 + 1, iy * 2 + 1);
    } else if (!t.mesh) this.wanted.push({ tile: t, dist: this.boxDist(size, ix, iy) });
  }

  private build(t: Tile): void {
    const { land, heights, color } = this;
    const cell = t.size / CELLS;
    const x0 = t.ix * t.size;
    const y0 = t.iy * t.size;
    const v = CELLS + 1;
    const total = v * v + SKIRT_VERTS;
    const pos = new Float32Array(total * 3);
    const nor = new Float32Array(total * 3);
    const col = new Float32Array(total * 3);
    const uv = new Float32Array(total * 2);
    // Heights with a border of one, for normals that match across tile edges.
    const w = CELLS + 3;
    for (let j = 0; j < w; j++) {
      for (let i = 0; i < w; i++) heights[j * w + i] = land.height(x0 + (i - 1) * cell, y0 + (j - 1) * cell, cell);
    }
    const uOff = Math.floor(x0 / UV_SIZE) * UV_SIZE;
    const vOff = Math.floor(y0 / UV_SIZE) * UV_SIZE;
    const half = t.size / 2;
    for (let j = 0; j <= CELLS; j++) {
      for (let i = 0; i <= CELLS; i++) {
        const k = j * v + i;
        const a = (j + 1) * w + i + 1;
        const h = heights[a];
        const gx = (heights[a + 1] - heights[a - 1]) / (2 * cell);
        const gy = (heights[a + w] - heights[a - w]) / (2 * cell);
        const x = x0 + i * cell;
        const y = y0 + j * cell;
        pos[k * 3] = x - x0 - half;
        pos[k * 3 + 1] = h;
        pos[k * 3 + 2] = y - y0 - half;
        const len = Math.hypot(gx, 1, gy);
        nor[k * 3] = -gx / len;
        nor[k * 3 + 1] = 1 / len;
        nor[k * 3 + 2] = -gy / len;
        // (Sets the road distance colour needs.)
        land.height(x, y, cell);
        land.color(h, Math.hypot(gx, gy), x, y, cell, color);
        col[k * 3] = color[0];
        col[k * 3 + 1] = color[1];
        col[k * 3 + 2] = color[2];
        uv[k * 2] = (x - uOff) / UV_SIZE;
        uv[k * 2 + 1] = (y - vOff) / UV_SIZE;
      }
    }
    // Skirt verts copy their edge vertex, hanging lower.
    const edgeIndex = (s: number): number => {
      if (s <= CELLS) return s;
      if (s <= CELLS * 2) return (s - CELLS) * v + CELLS;
      if (s <= CELLS * 3) return CELLS * v + (CELLS * 3 - s);
      return (CELLS * 4 - s) * v;
    };
    const drop = cell * 0.9 + 1;
    for (let s = 0; s < SKIRT_VERTS; s++) {
      const e = edgeIndex(s);
      const k = v * v + s;
      pos[k * 3] = pos[e * 3];
      pos[k * 3 + 1] = pos[e * 3 + 1] - drop;
      pos[k * 3 + 2] = pos[e * 3 + 2];
      for (let c = 0; c < 3; c++) {
        nor[k * 3 + c] = nor[e * 3 + c];
        col[k * 3 + c] = col[e * 3 + c];
      }
      uv[k * 2] = uv[e * 2];
      uv[k * 2 + 1] = uv[e * 2 + 1];
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(this.index);
    const mesh = new THREE.Mesh(geo, this.material);
    mesh.position.set(x0 + half, 0, y0 + half);
    mesh.updateMatrixWorld();
    // Heights are known, so the bounding box is tight: tiles behind a hill or off screen aren't drawn.
    geo.computeBoundingSphere();
    mesh.visible = false;
    t.mesh = mesh;
    this.group.add(mesh);
  }

  dispose(): void {
    for (const t of this.tiles.values()) t.mesh?.geometry.dispose();
    this.tiles.clear();
    this.group.clear();
  }
}
