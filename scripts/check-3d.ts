/**
 * Checks the 3D ground on every circuit: the land must stay under the road, kerbs, run-off and
 * pit lane (else green patches show through and cars look sunk), and under the wall tops.
 *
 *   npx tsx scripts/check-3d.ts [track ids...]
 */
import { Track } from '../src/track/track';
import { REAL_TRACK_IDS, TRACKS } from '../src/tracks';
import { Terrain } from '../src/render3d/terrain';
import { waterOf } from '../src/render3d/landmarks';

const ids = process.argv.slice(2);
let bad = 0;
for (const id of ids.length ? ids : REAL_TRACK_IDS) {
  const track = new Track(TRACKS[id]);
  const water = waterOf(track);
  const terrain = new Terrain(track, (x, y) => water.levelAt(x, y));
  let points = 0;
  let above = 0;
  let worst = 0;
  let worstAt = 0;
  const n = track.samples.length;
  for (let i = 0; i < n; i++) {
    const s = track.samples[i];
    const b = track.samples[(i + 1) % n];
    // A point part way to the next sample, as the road quads join them.
    for (const t of [0, 0.5]) {
      const z = s.z + (b.z - s.z) * t;
      const px = s.x + (b.x - s.x) * t;
      const py = s.y + (b.y - s.y) * t;
      for (const [edge, side] of [[s.wallL, -1], [s.wallR, 1]] as const) {
        for (let off = 0; off <= edge; off += 2) {
          const x = px + s.nx * off * side;
          const y = py + s.ny * off * side;
          const h = terrain.heightAt(x, y);
          points++;
          if (h > z - 0.02) {
            above++;
            if (h - z > worst) [worst, worstAt] = [h - z, s.s / track.length];
          }
        }
      }
    }
  }
  const share = above / points;
  if (share > 0) bad++;
  console.log(`${id.padEnd(14)} land above the road at ${(share * 100).toFixed(2)}% of points, worst ${worst.toFixed(1)} m at ${worstAt.toFixed(2)} of the lap`);
}
console.log(bad ? `${bad} tracks with land over the road` : 'all clear');
