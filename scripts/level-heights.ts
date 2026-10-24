/**
 * Evens out the heights where two stretches of a track run side by side. The terrain data
 * (SRTM) reads buildings and trees, so a stretch could sit 10-20 m above the one next to it,
 * standing on a huge wall in 3D. Here the land between neighbouring stretches may slope at
 * most MAX_CROSS (rise per metre of gap between their walls); heights are eased towards each
 * other, smoothly along the lap, until it does. Real hillsides keep most of their height.
 *
 *   npx tsx scripts/level-heights.ts [--dry] [track ids...]
 *
 * scripts/elevation.ts runs this on new heights too.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { Track } from '../src/track/track';
import { REAL_TRACK_IDS, TRACKS } from '../src/tracks';
import type { TrackDef } from '../src/track/types';

/** Steepest slope of the land between two stretches, over the gap between their walls. */
const MAX_CROSS = 0.25;
/** Stretches closer than this (m, centre to centre) count as side by side. */
const NEAR = 120;
/** Corrections are spread along the lap over about this far (m) either side. */
const SPREAD = 60;

/** The heights (every `step` m of the lap) with side-by-side stretches evened out. */
export function levelHeights(def: TrackDef, heights: number[], step: number): number[] {
  const track = new Track({ ...def, elevation: undefined, scenery: undefined });
  const m = heights.length;
  const at = (k: number) => track.samples[Math.round((k * step) / 2) % track.samples.length];
  const reach = (k: number) => Math.max(at(k).wallL, at(k).wallR);
  // Pairs of points on different stretches of the lap (much further apart along the lap than across).
  const pairs: { a: number; b: number; gap: number }[] = [];
  for (let a = 0; a < m; a++) {
    for (let b = a + 1; b < m; b++) {
      const pa = at(a);
      const pb = at(b);
      const d = Math.hypot(pa.x - pb.x, pa.y - pb.y);
      if (d > NEAR) continue;
      let ds = Math.abs(a - b) * step;
      ds = Math.min(ds, m * step - ds);
      if (ds < 3 * d + 40) continue;
      pairs.push({ a, b, gap: Math.max(4, d - (reach(a) + reach(b)) / 2) });
    }
  }
  const h = [...heights];
  const radius = Math.max(1, Math.round(SPREAD / step));
  for (let iter = 0; iter < 200; iter++) {
    const corr = new Array<number>(m).fill(0);
    let worst = 0;
    for (const { a, b, gap } of pairs) {
      const dz = h[a] - h[b];
      const excess = Math.abs(dz) - MAX_CROSS * gap;
      if (excess <= 0) continue;
      worst = Math.max(worst, excess);
      const fix = (Math.sign(dz) * excess) / 2;
      // The biggest correction asked of each point wins (several pairs can ask).
      if (Math.abs(fix) > Math.abs(corr[a])) corr[a] = -fix;
      if (Math.abs(fix) > Math.abs(corr[b])) corr[b] = fix;
    }
    if (worst < 0.1) break;
    // Spread each correction smoothly along the lap (a triangle window, peak kept), so no step appears.
    const spread = new Array<number>(m).fill(0);
    for (let k = 0; k < m; k++) {
      if (corr[k] === 0) continue;
      for (let j = -radius; j <= radius; j++) {
        const i = (((k + j) % m) + m) % m;
        const v = corr[k] * (1 - Math.abs(j) / (radius + 1));
        if (Math.abs(v) > Math.abs(spread[i])) spread[i] = v;
      }
    }
    for (let k = 0; k < m; k++) h[k] += spread[k] * 0.5;
  }
  const min = Math.min(...h);
  return h.map((v) => Math.round((v - min) * 10) / 10);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const dry = args.includes('--dry');
  const ids = args.filter((a) => a !== '--dry');
  for (const id of ids.length ? ids : REAL_TRACK_IDS) {
    const def = TRACKS[id];
    if (!def.elevation) continue;
    const { step, heights } = def.elevation;
    const out = levelHeights(def, heights, step);
    let moved = 0;
    for (let k = 0; k < out.length; k++) moved = Math.max(moved, Math.abs(out[k] - (heights[k] - Math.min(...heights))));
    const range = (h: number[]) => Math.max(...h) - Math.min(...h);
    console.log(`${id.padEnd(14)} range ${range(heights).toFixed(1)} -> ${range(out).toFixed(1)} m, moved up to ${moved.toFixed(1)} m`);
    if (dry || moved < 0.05) continue;
    const file = `src/tracks/${id}.json`;
    const text = readFileSync(file, 'utf8');
    const next = text.replace(/"elevation": \{[^}]*\}/s, `"elevation": ${JSON.stringify({ step, heights: out })}`);
    JSON.parse(next);
    writeFileSync(file, next);
  }
}
