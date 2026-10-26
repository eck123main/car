/**
 * Find the ideal line for each track (src/tracks/ideal-lines.json): the racing line and speeds
 * that set the fastest lap when driven in the real physics, in time trial (rolling start, softs,
 * DRS everywhere, ERS). A lap only counts if it stays on track and never touches a wall, so the
 * line is one a player can copy lap after lap.
 *
 *   npx tsx scripts/ideal-lines.ts [trackId ...]
 *
 * Per track: the minimum-curvature line for a few edge margins (how close to the edge it goes:
 * onto the kerbs, or a little short of them), then the share of grip used in corners and under
 * braking, keeping the fastest clean lap. The ideal driver is a robot (`LineDriver`): good
 * players can still beat its lap, but the line and braking points are the ones to copy.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { buildIdeal, COARSE, LineDriver, solveMinimumCurvature, type IdealRecord, type IdealSettings } from '../src/sim/ai/idealLine';
import { TimeTrial } from '../src/sim/timeTrial';
import { Track } from '../src/track/track';
import { REAL_TRACK_IDS, TRACKS } from '../src/tracks';
import MEDALS from '../src/tracks/medals.json';

const OUT = 'src/tracks/ideal-lines.json';
const DT = 1 / 120;
const MARGINS = [0.2, 0.6, 1.0];
const CORNER = [0.97, 1, 1.03];
const BRAKE = [0.9, 1, 1.1];
/** Tried when nothing above gives a clean lap: further from the edges, and gentler. */
const FALLBACK = { margins: [1.4, 2.0], corner: [0.9, 0.94], brake: [0.8, 0.9] };

/** The ideal driver's first flying lap on this line, or null if it wasn't clean. */
function idealLap(track: Track, id: string, s: IdealSettings, coarse: number[]): number | null {
  const tt = new TimeTrial(track, id, 'Ideal', 'red');
  const driver = new LineDriver(track, buildIdeal(track, s, coarse), 'me');
  let lap: number | null = null;
  tt.onLap = (l) => (lap = l.time);
  for (let t = 0; t < 240; t += DT) {
    const timing = tt.me.timer.lapStart !== null;
    const before = tt.me.car.damage;
    const events = tt.step(DT, driver.drive(tt.world));
    if (timing && (tt.invalidAt !== null || tt.me.car.damage > before)) return null;
    if (events.some((e) => e.kind === 'lap')) return lap;
  }
  return null;
}

function search(id: string): IdealRecord | null {
  return searchWith(id, MARGINS, CORNER, BRAKE) ?? searchWith(id, FALLBACK.margins, FALLBACK.corner, FALLBACK.brake);
}

function searchWith(id: string, margins: number[], corners: number[], brakes: number[]): IdealRecord | null {
  const track = new Track(TRACKS[id]);
  let best: IdealRecord | null = null;
  for (const margin of margins) {
    const offsets = solveMinimumCurvature(track, margin).map((o) => Math.round(o * 100) / 100);
    for (const corner of corners) {
      for (const brake of brakes) {
        const time = idealLap(track, id, { margin, corner, brake }, offsets);
        if (time !== null && (!best || time < best.time)) best = { margin, corner, brake, time: Math.round(time * 1000) / 1000, offsets };
      }
    }
  }
  return best;
}

const ids = process.argv.slice(2).length ? process.argv.slice(2) : REAL_TRACK_IDS;
const table: Record<string, IdealRecord> = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {};
const medals = MEDALS as Record<string, { author: number }>;
for (const id of ids) {
  const t0 = Date.now();
  const rec = search(id);
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  if (!rec) {
    console.log(`${id}: no clean lap found (${secs} s)`);
    continue;
  }
  table[id] = rec;
  const author = medals[id]?.author;
  const vs = author ? ` (author ${author.toFixed(2)}, ${(((rec.time - author) / author) * 100).toFixed(1)}%)` : '';
  console.log(`${id}: ${rec.time.toFixed(3)}${vs}  margin ${rec.margin} corner ${rec.corner} brake ${rec.brake}  (${secs} s)`);
  // Compact: one line per track.
  const keys = Object.keys(table).sort();
  writeFileSync(OUT, '{\n' + keys.map((k) => `  ${JSON.stringify(k)}: ${JSON.stringify(table[k])}`).join(',\n') + '\n}\n');
}
if (COARSE !== 4) console.warn('COARSE changed: every stored line needs solving again');
