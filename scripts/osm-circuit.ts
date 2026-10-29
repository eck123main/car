/**
 * Trace a circuit from OpenStreetMap: one lap of its `highway=raceway` ways, as GeoJSON for
 * scripts/import-track.ts and scripts/elevation.ts (feature id `osm-<id>`).
 *
 *   npx tsx scripts/osm-circuit.ts <id> <lat,lon> <lap metres> <out.geojson> [--radius 1500]
 *     [--dir cw|ccw] [--start lat,lon] [--exclude wayId,...] [--require wayId,...] [--pick k] [--cache dir]
 *
 * Downloads the raceways within --radius of the point (Overpass API), leaves out pit lanes, karting,
 * rallycross, dirt and disused ways, joins the rest at shared nodes and finds the simple loops within
 * 25% of the real lap length. The one closest to it is written (--pick k for the k-th closest, after
 * checking the list it prints; --require / --exclude ways to steer it onto the real layout). The lap
 * runs in the real direction (--dir, default clockwise) and starts beside the middle of the pit lane
 * (or --start). Map data © OpenStreetMap contributors (ODbL).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

type Way = { type: string; id: number; tags?: Record<string, string>; geometry: { lat: number; lon: number }[] };
type Edge = { way: number; nodes: string[]; len: number; a: string; b: string };

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const [id, at, lapArg, out] = args;
if (!id || !at || !lapArg || !out) {
  console.error('Usage: osm-circuit.ts <id> <lat,lon> <lap metres> <out.geojson> [--radius m] [--dir cw|ccw] [--start lat,lon] [--exclude ids] [--require ids] [--pick k] [--cache dir]');
  process.exit(1);
}
const target = Number(lapArg);
const ids = (name: string) => new Set((flag(name) ?? '').split(',').filter(Boolean).map(Number));
const exclude = ids('exclude');
const required = [...ids('require')];

const ways = await download();
const isPit = (w: Way) => /(^|\s)pit/i.test(`${w.tags?.name} ${w.tags?.['name:en']}`) || /pit_?lane/.test(`${w.tags?.service} ${w.tags?.raceway}`) || w.tags?.pit_lane === 'yes';
const track = ways.filter(
  (w) =>
    w.type === 'way' &&
    !exclude.has(w.id) &&
    !isPit(w) &&
    !w.tags?.disused &&
    !/safety|emergency/i.test(w.tags?.name ?? '') &&
    !/kart|rally|off_road|drag|motocross|bicycle/i.test(w.tags?.sport ?? '') &&
    !/dirt|unpaved|gravel|grass|ground/i.test(w.tags?.surface ?? ''),
);

// Nodes by position (ways that join share a node, so the same coordinates).
const key = (g: { lat: number; lon: number }) => `${g.lat},${g.lon}`;
const pos = new Map<string, [number, number]>();
const degree = new Map<string, number>();
for (const w of track) {
  w.geometry.forEach((g, i) => {
    pos.set(key(g), [g.lon, g.lat]);
    degree.set(key(g), (degree.get(key(g)) ?? 0) + (i === 0 || i === w.geometry.length - 1 ? 1 : 2));
  });
}
const [lat0] = at.split(',').map(Number);
const metres = (a: string, b: string) => {
  const p = pos.get(a)!;
  const q = pos.get(b)!;
  return Math.hypot((p[0] - q[0]) * 111_320 * Math.cos((lat0 * Math.PI) / 180), (p[1] - q[1]) * 110_540);
};

// Edges: way pieces between junctions.
const edges: Edge[] = [];
for (const w of track) {
  const nodes = w.geometry.map(key);
  let from = 0;
  for (let i = 1; i < nodes.length; i++) {
    if (i < nodes.length - 1 && degree.get(nodes[i]) === 2) continue;
    const piece = nodes.slice(from, i + 1);
    let len = 0;
    for (let k = 1; k < piece.length; k++) len += metres(piece[k - 1], piece[k]);
    edges.push({ way: w.id, nodes: piece, len, a: piece[0], b: piece[piece.length - 1] });
    from = i;
  }
}
const adjacent = new Map<string, number[]>();
edges.forEach((e, i) => {
  for (const v of [e.a, e.b]) adjacent.set(v, [...(adjacent.get(v) ?? []), i]);
});

// Simple loops within 25% of the lap length, each found once (from its lowest edge).
const loops: { path: number[]; len: number }[] = [];
const seen = new Set<string>();
for (let s = 0; s < edges.length; s++) {
  const start = edges[s].a;
  const used = new Set([s]);
  const visited = new Set([start, edges[s].b]);
  const path = [s];
  const walk = (v: string, len: number) => {
    if (loops.length > 20_000) return;
    for (const ei of adjacent.get(v) ?? []) {
      if (ei < s || used.has(ei)) continue;
      const e = edges[ei];
      const w = e.a === v ? e.b : e.a;
      const total = len + e.len;
      if (total > target * 1.25) continue;
      if (w === start) {
        const id = [...path, ei].sort((x, y) => x - y).join(',');
        if (total > target * 0.75 && !seen.has(id)) {
          seen.add(id);
          loops.push({ path: [...path, ei], len: total });
        }
        continue;
      }
      if (visited.has(w)) continue;
      used.add(ei);
      visited.add(w);
      path.push(ei);
      walk(w, total);
      path.pop();
      visited.delete(w);
      used.delete(ei);
    }
  };
  walk(edges[s].b, edges[s].len);
}
const candidates = loops
  .filter((l) => required.every((r) => l.path.some((i) => edges[i].way === r)))
  .sort((x, y) => Math.abs(x.len - target) - Math.abs(y.len - target));
candidates.slice(0, 5).forEach((l, k) => console.log(`  ${k}: ${Math.round(l.len)} m, ways ${[...new Set(l.path.map((i) => edges[i].way))].join(' ')}`));
const pick = candidates[Number(flag('pick') ?? 0)];
if (!pick) {
  console.error(`${id}: no loop near ${target} m (${track.length} ways, ${loops.length} loops)`);
  process.exit(1);
}

// The loop as coordinates, in the real direction, starting beside the pit lane.
let coords: [number, number][] = [];
let v = edges[pick.path[0]].a;
for (const ei of pick.path) {
  const e = edges[ei];
  const nodes = e.a === v ? e.nodes : [...e.nodes].reverse();
  for (let k = coords.length ? 1 : 0; k < nodes.length; k++) coords.push(pos.get(nodes[k])!);
  v = nodes[nodes.length - 1];
}
coords.pop();
let area = 0;
coords.forEach((p, i) => {
  const q = coords[(i + 1) % coords.length];
  area += p[0] * q[1] - q[0] * p[1];
});
// Longitude/latitude with y up: positive area is anticlockwise.
if (area > 0 !== (flag('dir') === 'ccw')) coords.reverse();
let startAt = flag('start')?.split(',').map(Number).reverse() as [number, number] | undefined;
if (!startAt) {
  const length = (w: Way) => w.geometry.reduce((t, g, i) => (i ? t + Math.hypot(g.lon - w.geometry[i - 1].lon, g.lat - w.geometry[i - 1].lat) : 0), 0);
  const pit = ways.filter((w) => isPit(w) && !w.tags?.disused && !/old|disused/i.test(w.tags?.name ?? '')).sort((a, b) => length(b) - length(a))[0];
  if (pit) {
    // Halfway along the pit lane.
    const g = pit.geometry;
    let left = length(pit) / 2;
    for (let i = 1; i < g.length && !startAt; i++) {
      const step = Math.hypot(g[i].lon - g[i - 1].lon, g[i].lat - g[i - 1].lat);
      if (step >= left) startAt = [g[i - 1].lon + ((g[i].lon - g[i - 1].lon) * left) / step, g[i - 1].lat + ((g[i].lat - g[i - 1].lat) * left) / step];
      left -= step;
    }
  }
  else console.log('  no pit lane mapped: give --start');
}
if (startAt) {
  // The nearest point of the lap (on a segment: straights may have nodes only at their ends).
  const [x, y] = startAt;
  const k = Math.cos((lat0 * Math.PI) / 180);
  let best = { d: Infinity, i: 0, p: coords[0] };
  coords.forEach((a, i) => {
    const b = coords[(i + 1) % coords.length];
    const [dx, dy] = [(b[0] - a[0]) * k, b[1] - a[1]];
    const t = Math.max(0, Math.min(1, (((x - a[0]) * k * dx + (y - a[1]) * dy) / (dx * dx + dy * dy)) || 0));
    const p: [number, number] = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    const d = Math.hypot((p[0] - x) * k, p[1] - y);
    if (d < best.d) best = { d, i, p };
  });
  coords = [best.p, ...coords.slice(best.i + 1), ...coords.slice(0, best.i + 1)].filter((c, i) => i === 0 || c[0] !== best.p[0] || c[1] !== best.p[1]);
}
coords.push(coords[0]);
writeFileSync(out, JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: { id: `osm-${id}` }, geometry: { type: 'LineString', coordinates: coords } }] }));
console.log(`${id}: ${Math.round(pick.len)} m lap, ${coords.length} points, wrote ${out}`);

/** Raceway ways near the circuit, from the cache or the Overpass API (with fallback mirrors). */
async function download(): Promise<Way[]> {
  const cacheDir = flag('cache');
  const cacheFile = cacheDir ? `${cacheDir}/${id}.json` : null;
  if (cacheFile && existsSync(cacheFile)) return (JSON.parse(readFileSync(cacheFile, 'utf8')) as { elements: Way[] }).elements;
  const [lat, lon] = at.split(',').map(Number);
  const query = `[out:json][timeout:50];way["highway"="raceway"](around:${Number(flag('radius') ?? 1500)},${lat},${lon});out geom tags;`;
  const hosts = ['https://overpass-api.de/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
  for (let attempt = 0; attempt < 3; attempt++) {
    for (const host of hosts) {
      try {
        const res = await fetch(host, {
          method: 'POST',
          body: `data=${encodeURIComponent(query)}`,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          signal: AbortSignal.timeout(60_000),
        });
        if (!res.ok) continue;
        const data = (await res.json()) as { elements: Way[] };
        if (cacheFile) {
          if (!existsSync(cacheDir!)) mkdirSync(cacheDir!, { recursive: true });
          writeFileSync(cacheFile, JSON.stringify(data));
        }
        return data.elements;
      } catch {
        // Busy or slow mirror: try the next one.
      }
    }
  }
  throw new Error(`${id}: Overpass API didn't answer`);
}
