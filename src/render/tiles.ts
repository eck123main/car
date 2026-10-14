import type { ViewBounds } from './camera';

/** Tile side in device pixels (plus PAD on every edge). */
const TILE_PX = 512;
/** Extra pixels rendered round each tile, so neighbours overlap without seams. */
const PAD = 2;
/** Tiles just outside the view rendered ahead of time per frame, so driving onto them never stalls. */
const PREFETCH_PER_FRAME = 2;

type Tile = HTMLCanvasElement | OffscreenCanvas;
type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/**
 * Caches a static world drawing (track, kerbs, scenery) as bitmap tiles. Redrawing all those
 * vector shapes every frame took ~20 ms on a 4K screen; pasting a few tiles takes ~1 ms.
 * Tiles are rendered at the sharpest zoom the camera uses, and scaled down when it zooms out.
 */
export class TileCache {
  private readonly tiles = new Map<string, Tile>();
  private spare: Tile[] = [];
  /** Pixels per metre the tiles are drawn at. */
  private res = 0;

  constructor(private readonly drawWorld: (ctx: CanvasRenderingContext2D, view: ViewBounds) => void) {}

  /**
   * Draw the visible tiles. ctx must already be in world metres. `res` is the tile
   * resolution in device pixels per metre; changing it throws the old tiles away.
   */
  draw(ctx: CanvasRenderingContext2D, view: ViewBounds, res: number): void {
    if (Math.abs(res - this.res) > 0.01) {
      this.res = res;
      this.tiles.clear();
      this.spare = [];
    }
    const size = TILE_PX / res;
    const i0 = Math.floor(view.minX / size);
    const i1 = Math.floor(view.maxX / size);
    const j0 = Math.floor(view.minY / size);
    const j1 = Math.floor(view.maxY / size);
    // A screen and a half of tiles stays cached: enough to turn round without redrawing.
    const keep = Math.ceil((i1 - i0 + 3) * (j1 - j0 + 3) * 1.5);

    // Overlap neighbours by a pixel so the joins never show the background.
    const o = 1;
    const ow = o / res;
    ctx.imageSmoothingEnabled = true;
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const tile = this.tile(i, j, size);
        ctx.drawImage(tile, PAD - o, PAD - o, TILE_PX + 2 * o, TILE_PX + 2 * o, i * size - ow, j * size - ow, size + 2 * ow, size + 2 * ow);
      }
    }

    // Render a couple of the tiles round the edge of the view ahead of time.
    let budget = PREFETCH_PER_FRAME;
    for (let i = i0 - 1; i <= i1 + 1 && budget > 0; i++) {
      for (let j = j0 - 1; j <= j1 + 1 && budget > 0; j++) {
        if (i >= i0 && i <= i1 && j >= j0 && j <= j1) continue;
        if (this.tiles.has(`${i},${j}`)) continue;
        this.tile(i, j, size);
        budget--;
      }
    }

    while (this.tiles.size > keep) {
      const oldest = this.tiles.keys().next().value!;
      this.spare.push(this.tiles.get(oldest)!);
      this.tiles.delete(oldest);
    }
  }

  private tile(i: number, j: number, size: number): Tile {
    const key = `${i},${j}`;
    let tile = this.tiles.get(key);
    if (tile) {
      // Most recently used goes last; the first entries are the ones to drop.
      this.tiles.delete(key);
      this.tiles.set(key, tile);
      return tile;
    }
    tile = this.spare.pop() ?? newCanvas(TILE_PX + 2 * PAD);
    const ctx = tile.getContext('2d') as Ctx2D;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, tile.width, tile.height);
    const x0 = i * size;
    const y0 = j * size;
    const pad = PAD / this.res;
    ctx.setTransform(this.res, 0, 0, this.res, PAD - x0 * this.res, PAD - y0 * this.res);
    this.drawWorld(ctx as CanvasRenderingContext2D, { minX: x0 - pad, minY: y0 - pad, maxX: x0 + size + pad, maxY: y0 + size + pad });
    this.tiles.set(key, tile);
    return tile;
  }
}

function newCanvas(px: number): Tile {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(px, px);
  const c = document.createElement('canvas');
  c.width = c.height = px;
  return c;
}
