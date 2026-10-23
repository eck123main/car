/**
 * Real elevation for the circuits: samples terrain heights (SRTM, 30 m, via the free
 * OpenTopoData API) along each track and writes them into its file as `"elevation"`.
 *
 *   npx tsx scripts/elevation.ts <f1-circuits.geojson> [--cache dir] [--dry] [track ids...]
 *
 * The GeoJSON is bacinger/f1-circuits' combined file (f1-circuits.geojson). Each track was
 * imported from it centred on the mean of its coordinates and scaled (see trackFromGeoJson), so
 * the script finds the scale that fits best, checks the fit, and maps every point of the lap
 * back to latitude/longitude. Heights are scaled like the track (real gradients on a half-size
 * track: half the height), smoothed (the data includes trees and buildings), and stored every
 * STEP metres of the lap from the start line, lowest point = 0. Tracks traced from OpenStreetMap
 * (not in the file) are skipped. --dry prints without writing. --cache keeps API answers.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { Track } from '../src/track/track';
import { TRACKS } from '../src/tracks';

/** Track id → feature id in bacinger/f1-circuits. */
const FEATURES: Record<string, string> = {
  'albert-park': 'au-1953', bahrain: 'bh-2002', shanghai: 'cn-2004', barcelona: 'es-1991', monaco: 'mc-1929',
  montreal: 'ca-1978', 'paul-ricard': 'fr-1969', 'red-bull-ring': 'at-1969', silverstone: 'gb-1948',
  hockenheim: 'de-1932', hungaroring: 'hu-1986', spa: 'be-1925', monza: 'it-1922', singapore: 'sg-2008',
  sochi: 'ru-2014', suzuka: 'jp-1962', cota: 'us-2012', mexico: 'mx-1962', interlagos: 'br-1940',
  'yas-marina': 'ae-2009', imola: 'it-1953', nurburgring: 'de-1927', portimao: 'pt-2008', mugello: 'it-1914',
  sepang: 'my-1999', istanbul: 'tr-2005', zandvoort: 'nl-1948', 'magny-cours': 'fr-1960', estoril: 'pt-1972',
  jacarepagua: 'br-1977', jeddah: 'sa-2021', miami: 'us-2022', lusail: 'qa-2004', madrid: 'es-2026',
  baku: 'az-2016', 'las-vegas': 'us-2023', indianapolis: 'us-1909', 'buenos-aires': 'ar-1952',
  kyalami: 'za-1961', 'watkins-glen': 'us-1956',
};

/** Heights every this many metres of the (game) lap. */
export const STEP = 10;
const SCALES = [0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
/** Mean distance (m) from the track to the real circuit above which the fit is rejected. */
const MAX_FIT = 8;
/** Smoothing: moving averages over this many samples (each STEP m), applied in turn. */
const SMOOTH = [7, 5, 3];
/** Median filter first (samples): spikes from buildings and trees go. */
const MEDIAN = 9;
/** Steepest slope kept (real F1 tracks top out around 18%, Eau Rouge). */
const MAX_GRADE = 0.18;
/** Street circuits where buildings make the data rougher than the road: a lower limit. */
const GRADE_CAP: Record<string, number> = { monaco: 0.12, baku: 0.1 };
/** Nearly flat circuits where skyscrapers or trees fool the data: heights scaled down (checked against published figures). */
const FLATTEN: Record<string, number> = { singapore: 0.15, 'las-vegas': 0.3, 'buenos-aires': 0.3, 'albert-park': 0.5 };

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const dry = args.includes('--dry');
if (dry) args.splice(args.indexOf('--dry'), 1);
const cacheDir = flag('cache');
const [geoFile, ...only] = args;
if (!geoFile) {
  console.error('Usage: elevation.ts <f1-circuits.geojson> [--cache dir] [--dry] [track ids...]');
  process.exit(1);
}
const geo = JSON.parse(readFileSync(geoFile, 'utf8')) as { features: { properties: { id: string }; geometry: { coordinates: [number, number][] } }[] };
if (cacheDir && !existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true });

for (const id of only.length ? only : Object.keys(FEATURES)) {
  const feature = geo.features.find((f) => f.properties.id === FEATURES[id]);
  if (!feature || !TRACKS[id]) {
    console.log(`${id}: no source coordinates, skipped`);
    continue;
  }
  const track = new Track({ ...TRACKS[id], scenery: undefined });
  const coords = feature.geometry.coordinates;
  const lat0 = coords.reduce((s, c) => s + c[1], 0) / coords.length;
  const lon0 = coords.reduce((s, c) => s + c[0], 0) / coords.length;
  const mPerLon = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  const mPerLat = 110_540;

  // Which scale was the track imported at? The one where the real circuit lies on the track.
  let best = { scale: 0, fit: Infinity };
  for (const scale of SCALES) {
    const pts = densify(coords.map(([lon, lat]) => [(lon - lon0) * mPerLon * scale, -(lat - lat0) * mPerLat * scale] as [number, number]), 3);
    let sum = 0;
    for (let i = 0; i < track.samples.length; i += 5) {
      const s = track.samples[i];
      let d = Infinity;
      for (const p of pts) d = Math.min(d, Math.hypot(p[0] - s.x, p[1] - s.y));
      sum += d;
    }
    const fit = sum / Math.ceil(track.samples.length / 5);
    if (fit < best.fit) best = { scale, fit };
  }
  if (best.fit > MAX_FIT) {
    console.log(`${id}: the real circuit doesn't line up with the track (best ${best.fit.toFixed(1)} m at scale ${best.scale}), skipped`);
    continue;
  }
  const { scale } = best;

  // Latitude/longitude every STEP m of the lap.
  const n = Math.round(track.length / STEP);
  const points: [number, number][] = [];
  for (let k = 0; k < n; k++) {
    const s = track.samples[Math.round((k * STEP) / 2) % track.samples.length];
    points.push([lat0 - s.y / (mPerLat * scale), lon0 + s.x / (mPerLon * scale)]);
  }
  const real = await heights(id, points);

  // Tunnels: the data reads the hill above, so the road runs straight from mouth to mouth.
  // Filters cover the same real distance on every track (Monaco is full size, most are half).
  const odd = (w: number) => Math.max(1, Math.round((w * 0.5) / scale)) | 1;
  let ground = medianClosed(real, odd(MEDIAN));
  for (const l of TRACKS[id].scenery?.landmarks ?? []) {
    if (l.type !== 'tunnel' || l.from === undefined || l.to === undefined) continue;
    const a = Math.floor(l.from * n);
    const len = ((Math.floor(l.to * n) - a) % n + n) % n;
    const h0 = ground[a];
    const h1 = ground[(a + len) % n];
    ground = ground.map((v, k) => {
      const off = ((k - a) % n + n) % n;
      return off <= len ? h0 + ((h1 - h0) * off) / len : v;
    });
  }

  // Real gradients: heights scale like the track. Then smooth, limit the slope, lowest = 0.
  let h = ground.map((v) => v * scale * (FLATTEN[id] ?? 1));
  for (const w of SMOOTH) h = smoothClosed(h, odd(w));
  h = limitGrade(h, (GRADE_CAP[id] ?? MAX_GRADE) * STEP);
  const min = Math.min(...h);
  h = h.map((v) => Math.round((v - min) * 10) / 10);
  const range = Math.max(...h);
  let steep = 0;
  let steepAt = 0;
  for (let k = 0; k < n; k++) {
    const g = Math.abs(h[(k + 1) % n] - h[k]) / STEP;
    if (g > steep) [steep, steepAt] = [g, k / n];
  }
  console.log(`${id}: scale ${scale} (fit ${best.fit.toFixed(1)} m), real ${Math.round(Math.max(...real) - Math.min(...real))} m, game ${range.toFixed(1)} m, steepest ${(steep * 100).toFixed(1)}% at ${steepAt.toFixed(2)} of the lap`);
  if (!dry) writeElevation(id, h);
}

/** Heights (m) at [lat, lon] points, 100 per request, at most one request a second. */
async function heights(id: string, points: [number, number][]): Promise<number[]> {
  const cacheFile = cacheDir ? `${cacheDir}/${id}.json` : null;
  if (cacheFile && existsSync(cacheFile)) {
    const cached = JSON.parse(readFileSync(cacheFile, 'utf8')) as { points: [number, number][]; heights: number[] };
    if (cached.points.length === points.length && cached.points.every((p, i) => Math.abs(p[0] - points[i][0]) < 1e-6 && Math.abs(p[1] - points[i][1]) < 1e-6)) return cached.heights;
  }
  const out: number[] = [];
  for (let i = 0; i < points.length; i += 100) {
    const batch = points.slice(i, i + 100);
    const url = `https://api.opentopodata.org/v1/srtm30m?locations=${batch.map(([la, lo]) => `${la.toFixed(6)},${lo.toFixed(6)}`).join('|')}`;
    type Answer = { status: string; results?: { elevation: number | null }[] };
    let data = null as Answer | null;
    for (let attempt = 0; attempt < 5 && data?.status !== 'OK'; attempt++) {
      await new Promise((r) => setTimeout(r, 1100 * (attempt + 1)));
      const res = await fetch(url);
      data = res.ok ? ((await res.json()) as Answer) : null;
    }
    if (data?.status !== 'OK' || !data.results) throw new Error(`${id}: elevation request failed`);
    for (const r of data.results) out.push(r.elevation ?? NaN);
  }
  // Fill any gaps from the neighbours.
  for (let i = 0; i < out.length; i++) if (!Number.isFinite(out[i])) out[i] = out[(i + out.length - 1) % out.length];
  if (cacheFile) writeFileSync(cacheFile, JSON.stringify({ points, heights: out }));
  return out;
}

function densify(pts: [number, number][], spacing: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / spacing));
    for (let k = 0; k < steps; k++) out.push([a[0] + ((b[0] - a[0]) * k) / steps, a[1] + ((b[1] - a[1]) * k) / steps]);
  }
  return out;
}

function medianClosed(h: number[], w: number): number[] {
  const n = h.length;
  const half = Math.floor(w / 2);
  return h.map((_, i) => {
    const win: number[] = [];
    for (let k = -half; k <= half; k++) win.push(h[(i + k + n) % n]);
    return win.sort((a, b) => a - b)[half];
  });
}

function smoothClosed(h: number[], w: number): number[] {
  const n = h.length;
  const half = Math.floor(w / 2);
  return h.map((_, i) => {
    let s = 0;
    for (let k = -half; k <= half; k++) s += h[(i + k + n) % n];
    return s / (2 * half + 1);
  });
}

/** Limit the change between neighbouring samples (both ways round the lap, a few passes). */
function limitGrade(h: number[], maxStep: number): number[] {
  const out = [...h];
  const n = out.length;
  for (let pass = 0; pass < 4; pass++) {
    for (let i = 0; i < n; i++) {
      const prev = out[(i + n - 1) % n];
      out[i] = Math.min(prev + maxStep, Math.max(prev - maxStep, out[i]));
    }
  }
  return out;
}

/** Put the heights into the track file (replacing old ones), keeping the file's layout. */
function writeElevation(id: string, h: number[]): void {
  const file = `src/tracks/${id}.json`;
  let text = readFileSync(file, 'utf8').replace(/,\s*"elevation": \{[^}]*\}/s, '');
  const end = text.lastIndexOf('}');
  text = text.slice(0, end).replace(/\s*$/, '') + `,\n  "elevation": ${JSON.stringify({ step: STEP, heights: h })}\n}\n`;
  JSON.parse(text);
  writeFileSync(file, text);
}
