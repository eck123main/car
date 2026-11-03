/** Seeded 2D gradient noise for the open road's land. Same seed, same world, on any machine. */

export function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A stable 0-1 number for a grid cell, for scattering things. */
export function hash2(ix: number, iy: number, seed: number): number {
  let h = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 2147483629);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function smoothstep(a: number, b: number, v: number): number {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export class Noise2D {
  private readonly perm = new Uint8Array(512);
  private readonly gx = new Float64Array(256);
  private readonly gy = new Float64Array(256);

  constructor(seed: number) {
    const rand = mulberry(seed);
    const p = Array.from({ length: 256 }, (_, i) => i);
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [p[i], p[j]] = [p[j], p[i]];
    }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
    for (let i = 0; i < 256; i++) {
      const a = rand() * Math.PI * 2;
      this.gx[i] = Math.cos(a);
      this.gy[i] = Math.sin(a);
    }
  }

  /** Smooth noise, about -1..1 (mostly -0.7..0.7). */
  at(x: number, y: number): number {
    const fx = Math.floor(x);
    const fy = Math.floor(y);
    const dx = x - fx;
    const dy = y - fy;
    const ix = fx & 255;
    const iy = fy & 255;
    const { perm, gx, gy } = this;
    const aa = perm[perm[ix] + iy];
    const ba = perm[perm[ix + 1] + iy];
    const ab = perm[perm[ix] + iy + 1];
    const bb = perm[perm[ix + 1] + iy + 1];
    const n00 = gx[aa] * dx + gy[aa] * dy;
    const n10 = gx[ba] * (dx - 1) + gy[ba] * dy;
    const n01 = gx[ab] * dx + gy[ab] * (dy - 1);
    const n11 = gx[bb] * (dx - 1) + gy[bb] * (dy - 1);
    const u = dx * dx * dx * (dx * (dx * 6 - 15) + 10);
    const v = dy * dy * dy * (dy * (dy * 6 - 15) + 10);
    const a = n00 + (n10 - n00) * u;
    const b = n01 + (n11 - n01) * u;
    return (a + (b - a) * v) * 1.5;
  }

  /** Layers of noise, each twice as fine and half as strong (about -1..1). */
  fbm(x: number, y: number, octaves: number): number {
    let sum = 0;
    let amp = 0.5;
    let f = 1;
    for (let i = 0; i < octaves; i++) {
      sum += this.at(x * f + i * 17.3, y * f - i * 9.1) * amp;
      amp *= 0.5;
      f *= 2.03;
    }
    return sum;
  }

  /** Sharp mountain ridges (0..1): each layer's detail is strongest high up, as on real ranges. */
  ridged(x: number, y: number, octaves: number): number {
    let sum = 0;
    let amp = 0.55;
    let f = 1;
    let weight = 1;
    for (let i = 0; i < octaves; i++) {
      const n = 1 - Math.abs(this.at(x * f + i * 31.7, y * f + i * 11.9));
      const s = n * n * weight;
      sum += s * amp;
      weight = Math.min(1, s * 2);
      amp *= 0.5;
      f *= 2.1;
    }
    return Math.min(1, sum);
  }
}
