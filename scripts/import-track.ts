/**
 * Import a circuit from GeoJSON (e.g. bacinger/f1-circuits) into src/tracks/.
 *
 *   npx tsx scripts/import-track.ts <file.geojson> <out.json> --name "Spa" [--scale 0.5]
 *     [--width 19] [--pit left|right] [--pit-range -150,170] [--start 120] [--drs 3]
 *
 * Prints what it finds (direction, length, pit lane, flat-out sections) and test-drives a
 * Hard bot lap. --drs N turns the N longest flat-out sections into DRS zones.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { F1_CAR } from '../src/physics/carParams';
import { BotDriver } from '../src/sim/ai/botDriver';
import { racingLine, speedProfile } from '../src/sim/ai/racingLine';
import { RaceWorld } from '../src/sim/world';
import { trackFromGeoJson, trackToJson } from '../src/track/io';
import { Track } from '../src/track/track';
import type { DrsZone, TrackDef } from '../src/track/types';

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const [src, out] = args;
if (!src || !out) {
  console.error('Usage: import-track.ts <file.geojson> <out.json> --name NAME [--scale 0.5] [--width 19] [--pit left|right] [--drs N]');
  process.exit(1);
}

const def: TrackDef = trackFromGeoJson(JSON.parse(readFileSync(src, 'utf8')), Number(flag('scale') ?? 0.5));
def.name = flag('name') ?? def.name;
def.width = Number(flag('width') ?? 19);
const pit = flag('pit');
if (pit === 'left' || pit === 'right') def.pit = { side: pit };
// --pit-range FROM,TO: lap distances for the pit lane (after any --start shift).
const range = flag('pit-range');
if (def.pit && range) {
  const [from, to] = range.split(',').map(Number);
  def.pit = { ...def.pit, from, to };
}
// --start M: move the start/finish line M metres forward (if the data starts mid-corner).
const startShift = Number(flag('start') ?? 0);
if (startShift) {
  // Insert a control point exactly at the new start (on the centreline), after the last
  // control point before it, then make it the first point.
  const probe = new Track(def);
  const t = probe.samples[Math.round(startShift / 2) % probe.samples.length];
  const lapPos = (x: number, y: number) => probe.query(x, y)?.s ?? 0;
  let best = 0;
  def.points.forEach(([x, y], i) => {
    const ahead = probe.forwardDistance(lapPos(x, y), t.s);
    if (ahead < probe.forwardDistance(lapPos(...def.points[best]), t.s)) best = i;
  });
  def.points.splice(best + 1, 0, [Math.round(t.x * 10) / 10, Math.round(t.y * 10) / 10]);
  best += 1;
  def.points = [...def.points.slice(best), ...def.points.slice(0, best)];
}

let track = new Track(def);
let area = 0;
const P = def.points;
for (let i = 0; i < P.length; i++) area += P[i][0] * P[(i + 1) % P.length][1] - P[(i + 1) % P.length][0] * P[i][1];
console.log(`${def.name}: ${area > 0 ? 'clockwise' : 'anticlockwise'}, ${track.length} m`);
console.log(track.pit ? `  pit lane: ${track.pit.side > 0 ? 'right' : 'left'}, ${track.forwardDistance(track.pit.entry, track.pit.exit)} m` : '  pit lane: NONE (no room on the start straight)');

// Flat-out sections from the Hard bot's speed plan: where DRS zones belong.
const v = speedProfile(track, racingLine(track), F1_CAR, 0.95);
const n = v.length;
const fast = v.map((x) => x >= 68);
const first = fast.indexOf(false);
const sections: { start: number; len: number }[] = [];
let st = -1;
for (let k = 1; k <= n; k++) {
  const i = (first + k) % n;
  if (fast[i] && st < 0) st = i;
  if (!fast[i] && st >= 0) {
    sections.push({ start: track.samples[st].s, len: ((((i - st) % n) + n) % n) * 2 });
    st = -1;
  }
}
for (const s of sections.filter((x) => x.len >= 120)) {
  console.log(`  flat out from ${s.start} m for ${s.len} m (${Math.round((s.start / track.length) * 100)}% of the lap)`);
}
const drs = Number(flag('drs') ?? 0);
if (drs > 0) {
  const wrap = (x: number) => ((x % track.length) + track.length) % track.length;
  def.drsZones = sections
    .filter((x) => x.len >= 150)
    .sort((a, b) => b.len - a.len)
    .slice(0, drs)
    .map((x): DrsZone => ({ detect: wrap(x.start - 80), start: wrap(x.start + 20), end: wrap(x.start + x.len - 40) }))
    .sort((a, b) => a.start - b.start);
  track = new Track(def);
  console.log(`  DRS zones: ${JSON.stringify(def.drsZones)}`);
}

// Test drive.
const world = new RaceWorld(track, { drsRule: 'free', wetness: 0 });
const r = world.addRacer('bot', 'Bot', 'red');
const s0 = track.samples[track.samples.length - 10];
r.car.place(s0.x, s0.y, Math.atan2(s0.ty, s0.tx));
const bot = new BotDriver(track, 'bot', 'hard');
const laps: number[] = [];
let walls = 0;
for (let t = 0; t < 400 && laps.length < 2; t += 1 / 120) {
  const before = r.car.lastImpact;
  const input = bot.drive(world, { phase: 'practice', raceStart: 0, laps: null, mandatoryStop: false }, 1 / 120);
  for (const e of world.step(1 / 120, new Map([['bot', input]]))) if (e.kind === 'lap') laps.push(e.lap.time);
  if (r.car.lastImpact !== before) walls++;
}
console.log(`  Hard bot: lap ${laps[1]?.toFixed(1) ?? 'not completed'} s, wall hits ${walls}, track limits ${r.timer.trackLimitWarnings}`);

writeFileSync(out, trackToJson(def));
console.log(`  wrote ${out}`);
