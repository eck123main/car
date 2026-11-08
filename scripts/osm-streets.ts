/**
 * Trace a street circuit from OpenStreetMap: the lap is routed along the roads through a list of
 * points in lap order (one per corner or street is plenty), as GeoJSON for scripts/import-track.ts
 * and scripts/elevation.ts (feature id `osm-<id>`). For street tracks that OSM doesn't map as
 * raceways, or maps only in a later layout (scripts/osm-circuit.ts finds laps of raceway ways).
 *
 *   npx tsx scripts/osm-streets.ts <id> <out.geojson> --via "lat,lon;lat,lon;..." [--round "lat,lon;..."]
 *     [--prefer wayId,...] [--link "lat,lon:lat,lon;..."] [--drop-spikes] [--cache dir]
 *
 * The first point is the start line. Each leg is the shortest drive along any road or raceway
 * (one-way streets ignored: races close them), so put a point on every street the lap uses and
 * between parallel streets. Prints each leg's length and the lap length to check against the
 * real one. --round drops the points within 25 m of each given corner, so the spline rounds it off:
 * for a corner tighter than the game's wider track can take (walls reaching the other side of it).
 * --prefer makes those ways (a riverside path where the pits were) count as roads. --link joins the
 * nearest road points to two places with a straight piece: a road the race used that is gone now.
 * Map data © OpenStreetMap contributors (ODbL).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

type Way = { type: string; id: number; tags?: Record<string, string>; geometry: { lat: number; lon: number }[] };

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const [id, out] = args;
const via = (flag('via') ?? '')
  .split(';')
  .filter((s) => s.trim())
  .map((s) => s.split(',').map(Number) as [number, number]);
if (!id || !out || via.length < 3) {
  console.error('Usage: osm-streets.ts <id> <out.geojson> --via "lat,lon;lat,lon;..." [--cache dir]');
  process.exit(1);
}

const lat0 = via.reduce((t, p) => t + p[0], 0) / via.length;
const kx = 111_320 * Math.cos((lat0 * Math.PI) / 180);
const ky = 110_540;
const ROADS = /^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|raceway)(_link)?$/;
/** Cost per metre: real roads first, then lanes, then paths (OSM sometimes splits a junction with a
 * cycleway or a crossing, which the race drove straight over). */
const preferred = new Set((flag('prefer') ?? '').split(',').filter(Boolean).map(Number));
const costOf = (w: Way) => (preferred.has(w.id) || ROADS.test(w.tags?.highway ?? '') ? 1 : w.tags?.highway === 'service' ? 3 : /^(footway|cycleway|path|pedestrian)$/.test(w.tags?.highway ?? '') ? 8 : 0);
const ways = (await download()).filter((w) => w.type === 'way' && costOf(w) > 0 && w.tags?.area !== 'yes');

// Graph of road nodes (joined ways share nodes, so the same coordinates).
const key = (g: { lat: number; lon: number }) => `${g.lat},${g.lon}`;
const pos = new Map<string, [number, number]>();
const links = new Map<string, Map<string, number>>();
const nameOf = new Map<string, string>();
const dist = (a: [number, number], b: [number, number]) => Math.hypot((a[1] - b[1]) * kx, (a[0] - b[0]) * ky);
for (const w of ways) {
  for (let i = 0; i < w.geometry.length; i++) {
    const k = key(w.geometry[i]);
    pos.set(k, [w.geometry[i].lat, w.geometry[i].lon]);
    if (!i) continue;
    const j = key(w.geometry[i - 1]);
    if (j === k) continue;
    const d = dist(pos.get(j)!, pos.get(k)!) * costOf(w);
    if (!links.has(k)) links.set(k, new Map());
    if (!links.has(j)) links.set(j, new Map());
    links.get(k)!.set(j, d);
    links.get(j)!.set(k, d);
    const name = w.tags?.name ?? w.tags?.highway ?? '?';
    nameOf.set(`${j}|${k}`, name);
    nameOf.set(`${k}|${j}`, name);
  }
}
// Dead ends join the nearest other road within 60 m, at a high cost: where a junction the race used
// has since been rebuilt (Reims' old RN31), a road just stops short of it.
const ownWay = new Map<string, number>();
for (const w of ways) for (const g of w.geometry) ownWay.set(key(g), w.id);
for (const [k, near] of [...links]) {
  if (near.size !== 1) continue;
  let best = { j: '', d: 60 };
  for (const [j, q] of pos) {
    if (j === k || near.has(j) || ownWay.get(j) === ownWay.get(k)) continue;
    const d = dist(pos.get(k)!, q);
    if (d < best.d) best = { j, d };
  }
  if (!best.j) continue;
  links.get(k)!.set(best.j, best.d * 10);
  links.get(best.j)?.set(k, best.d * 10);
  nameOf.set(`${k}|${best.j}`, 'gap');
  nameOf.set(`${best.j}|${k}`, 'gap');
}
const nearest = (p: [number, number]) => {
  let best = { k: '', d: Infinity };
  for (const [k, q] of pos) {
    const d = dist(p, q);
    if (d < best.d) best = { k, d };
  }
  if (best.d > 40) console.log(`  warning: ${p.join(',')} is ${Math.round(best.d)} m from the nearest road`);
  return best.k;
};

/** Cheapest drive from a to b (Dijkstra; the graph is a few thousand nodes). */
function route(a: string, b: string): string[] {
  const d = new Map([[a, 0]]);
  const prev = new Map<string, string>();
  const open = new Set([a]);
  const done = new Set<string>();
  while (open.size) {
    let u = '';
    let du = Infinity;
    for (const k of open) if (d.get(k)! < du) [u, du] = [k, d.get(k)!];
    open.delete(u);
    done.add(u);
    if (u === b) break;
    for (const [v, w] of links.get(u) ?? []) {
      if (done.has(v) || du + w >= (d.get(v) ?? Infinity)) continue;
      d.set(v, du + w);
      prev.set(v, u);
      open.add(v);
    }
  }
  if (!done.has(b)) throw new Error(`${id}: no road between ${pos.get(a)} and ${pos.get(b)}`);
  const path = [b];
  while (path[0] !== a) path.unshift(prev.get(path[0])!);
  return path;
}

for (const pair of (flag('link') ?? '').split(';').filter((x) => x.trim())) {
  const [a, b] = pair.split(':').map((p) => nearest(p.split(',').map(Number) as [number, number]));
  const d = dist(pos.get(a)!, pos.get(b)!);
  links.get(a)!.set(b, d);
  links.get(b)!.set(a, d);
  nameOf.set(`${a}|${b}`, 'link');
  nameOf.set(`${b}|${a}`, 'link');
}
const nodes = via.map(nearest);
let lap: string[] = [];
let total = 0;
for (let i = 0; i < nodes.length; i++) {
  const leg = route(nodes[i], nodes[(i + 1) % nodes.length]);
  let len = 0;
  for (let k = 1; k < leg.length; k++) len += dist(pos.get(leg[k - 1])!, pos.get(leg[k])!);
  total += len;
  console.log(`  leg ${i} -> ${(i + 1) % nodes.length}: ${Math.round(len)} m`);
  lap.push(...(lap.length ? leg.slice(1) : leg));
}
lap.pop();
// Drop out-and-back spurs (a via point just off the line).
for (let changed = true; changed; ) {
  changed = false;
  for (let i = 0; i < lap.length && lap.length > 3; i++) {
    const n = lap.length;
    if (lap[(i + n - 1) % n] === lap[(i + 1) % n]) {
      lap.splice(i, 1);
      lap.splice(i % lap.length, 1);
      changed = true;
    }
  }
}
// --drop-spikes: out along one carriageway of a dual road and back along the other (the lap comes back
// within 25 m of itself after 80+ m), where a junction only joins one side. Opt-in: on a tight street
// circuit the lap really does come back close to itself.
for (let i = 0; i < lap.length && args.includes('--drop-spikes'); i++) {
  let along = 0;
  for (let j = i + 1; j < Math.min(lap.length, i + 40); j++) {
    along += dist(pos.get(lap[j - 1])!, pos.get(lap[j])!);
    if (along > 80 && dist(pos.get(lap[i])!, pos.get(lap[j])!) < 25) {
      console.log(`  dropped a ${Math.round(along)} m spike at ${pos.get(lap[i])!.join(',')}`);
      lap.splice(i + 1, j - i - 1);
      break;
    }
  }
}
// The streets in lap order, with how far along each one is driven: to check the route.
const streets: string[] = [];
for (let i = 0; i < lap.length; i++) {
  const [a, b] = [lap[i], lap[(i + 1) % lap.length]];
  const name = nameOf.get(`${a}|${b}`) ?? '?';
  const d = dist(pos.get(a)!, pos.get(b)!);
  const last = streets.at(-1);
  if (last?.startsWith(`${name} (`)) streets[streets.length - 1] = `${name} (${Number(last.slice(name.length + 2, -3)) + Math.round(d)} m)`;
  else streets.push(`${name} (${Math.round(d)} m)`);
}
console.log(`  ${streets.join(' > ')}`);
const round = (flag('round') ?? '')
  .split(';')
  .filter((x) => x.trim())
  .map((x) => x.split(',').map(Number) as [number, number]);
const coords = lap.filter((k) => round.every((c) => dist(pos.get(k)!, c) > 25)).map((k) => [pos.get(k)![1], pos.get(k)![0]]);
coords.push(coords[0]);
let length = 0;
for (let i = 1; i < coords.length; i++) length += dist([coords[i - 1][1], coords[i - 1][0]], [coords[i][1], coords[i][0]]);
const visits = new Map<string, number>();
for (const k of lap) visits.set(k, (visits.get(k) ?? 0) + 1);
const repeated = [...visits.values()].filter((v) => v > 1).length;
if (repeated) console.log(`  warning: the lap uses ${repeated} nodes twice (a street driven both ways?)`);
writeFileSync(out, JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: { id: `osm-${id}` }, geometry: { type: 'LineString', coordinates: coords } }] }));
console.log(`${id}: ${Math.round(length)} m lap (legs ${Math.round(total)} m), ${coords.length} points, wrote ${out}`);

/** Roads around the via points, from the cache or the Overpass API (with fallback mirrors). */
async function download(): Promise<Way[]> {
  const cacheDir = flag('cache');
  const cacheFile = cacheDir ? `${cacheDir}/streets-${id}.json` : null;
  if (cacheFile && existsSync(cacheFile)) return (JSON.parse(readFileSync(cacheFile, 'utf8')) as { elements: Way[] }).elements;
  const pad = 0.004;
  const box = [
    Math.min(...via.map((p) => p[0])) - pad,
    Math.min(...via.map((p) => p[1])) - pad,
    Math.max(...via.map((p) => p[0])) + pad,
    Math.max(...via.map((p) => p[1])) + pad,
  ].join(',');
  const query = `[out:json][timeout:90];way["highway"](${box});out geom tags;`;
  const hosts = ['https://overpass-api.de/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
  for (let attempt = 0; attempt < 4; attempt++) {
    for (const host of hosts) {
      try {
        const res = await fetch(host, {
          method: 'POST',
          body: `data=${encodeURIComponent(query)}`,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'f1td-track-import/1.0' },
          signal: AbortSignal.timeout(100_000),
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
