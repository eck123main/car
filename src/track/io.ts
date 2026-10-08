import type { TrackDef } from './types';

type Pt = [number, number];

/** Validate untrusted JSON (a file or localStorage) as a TrackDef. Throws with a readable message. */
export function parseTrackDef(data: unknown): TrackDef {
  if (typeof data !== 'object' || data === null) throw new Error('Track file must be a JSON object');
  const d = data as Record<string, unknown>;
  const name = typeof d.name === 'string' && d.name.trim() ? d.name.trim().slice(0, 60) : 'Untitled';
  const width = typeof d.width === 'number' && d.width >= 6 && d.width <= 30 ? d.width : 14;
  if (!Array.isArray(d.points)) throw new Error('Track needs a "points" array');
  const points: Pt[] = [];
  for (const p of d.points) {
    if (!Array.isArray(p) || p.length < 2 || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) {
      throw new Error('Each point must be [x, y] numbers');
    }
    points.push([p[0], p[1]]);
  }
  if (points.length < 4) throw new Error('Track needs at least 4 points');
  if (points.length > 2000) throw new Error('Track has too many points (max 2000)');
  const def: TrackDef = { name, width, points };
  if (Array.isArray(d.drsZones)) {
    def.drsZones = [];
    for (const z of d.drsZones as Record<string, unknown>[]) {
      const { detect, start, end } = z ?? {};
      if (typeof detect === 'number' && typeof start === 'number' && typeof end === 'number') {
        def.drsZones.push({ detect, start, end });
      }
    }
  }
  if (typeof d.pit === 'object' && d.pit !== null) {
    const side = (d.pit as Record<string, unknown>).side;
    if (side === 'left' || side === 'right') def.pit = { side };
  }
  return def;
}

export function trackToJson(def: TrackDef): string {
  const rows: string[] = [];
  for (let i = 0; i < def.points.length; i += 6) {
    rows.push('    ' + def.points.slice(i, i + 6).map(([x, y]) => `[${round1(x)}, ${round1(y)}]`).join(', '));
  }
  const pit = def.pit ? `,\n  "pit": ${JSON.stringify(def.pit)}` : '';
  const drs = def.drsZones ? `,\n  "drsZones": ${JSON.stringify(def.drsZones)}` : '';
  return `{\n  "name": ${JSON.stringify(def.name)},\n  "width": ${def.width},\n  "points": [\n${rows.join(',\n')}\n  ]${drs}${pit}\n}\n`;
}

/**
 * Convert a GeoJSON circuit (LineString of [lon, lat], e.g. from bacinger/f1-circuits)
 * into track points in metres, scaled down by `scale` and cleaned up for editing.
 */
export function trackFromGeoJson(data: unknown, scale: number, fallbackName = 'Imported'): TrackDef {
  const coords = findLineString(data);
  if (!coords || coords.length < 4) throw new Error('No LineString with coordinates found in GeoJSON');
  const lat0 = coords.reduce((s, c) => s + c[1], 0) / coords.length;
  const lon0 = coords.reduce((s, c) => s + c[0], 0) / coords.length;
  const mPerLon = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  const mPerLat = 110_540;
  // North-up: y grows downwards on screen, so flip latitude.
  let pts: Pt[] = coords.map(([lon, lat]) => [(lon - lon0) * mPerLon * scale, -(lat - lat0) * mPerLat * scale]);
  if (dist(pts[0], pts[pts.length - 1]) < 1) pts.pop();

  pts = resampleClosed(pts, 6);
  pts = smoothClosed(pts, 2);
  pts = simplifyClosed(pts, 0.6);
  const props = findProperties(data);
  const name = typeof props?.Name === 'string' ? props.Name : fallbackName;
  return { name, width: 13, points: pts.map(([x, y]) => [round1(x), round1(y)]) };
}

function findLineString(data: unknown): Pt[] | null {
  if (typeof data !== 'object' || data === null) return null;
  const d = data as Record<string, unknown>;
  if (d.type === 'LineString' && Array.isArray(d.coordinates)) {
    return (d.coordinates as unknown[]).filter(
      (c): c is Pt => Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1]),
    );
  }
  if (d.type === 'Feature') return findLineString(d.geometry);
  if (d.type === 'FeatureCollection' && Array.isArray(d.features)) {
    for (const f of d.features) {
      const line = findLineString(f);
      if (line) return line;
    }
  }
  return null;
}

function findProperties(data: unknown): Record<string, unknown> | null {
  const d = data as { type?: string; properties?: Record<string, unknown>; features?: unknown[] };
  if (d?.type === 'Feature') return d.properties ?? null;
  if (d?.type === 'FeatureCollection' && Array.isArray(d.features)) return findProperties(d.features[0]);
  return null;
}

function resampleClosed(poly: Pt[], spacing: number): Pt[] {
  const n = poly.length;
  let total = 0;
  for (let i = 0; i < n; i++) total += dist(poly[i], poly[(i + 1) % n]);
  const count = Math.max(4, Math.round(total / spacing));
  const step = total / count;
  const out: Pt[] = [];
  let seg = 0;
  let segStart = 0;
  let segLen = dist(poly[0], poly[1]);
  for (let k = 0; k < count; k++) {
    const target = k * step;
    while (segStart + segLen < target && seg < n - 1) {
      segStart += segLen;
      seg++;
      segLen = dist(poly[seg], poly[(seg + 1) % n]);
    }
    const t = segLen > 0 ? (target - segStart) / segLen : 0;
    const a = poly[seg];
    const b = poly[(seg + 1) % n];
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  return out;
}

function smoothClosed(pts: Pt[], radius: number): Pt[] {
  const n = pts.length;
  return pts.map((_, i) => {
    let x = 0;
    let y = 0;
    for (let j = -radius; j <= radius; j++) {
      const p = pts[(((i + j) % n) + n) % n];
      x += p[0];
      y += p[1];
    }
    return [x / (2 * radius + 1), y / (2 * radius + 1)];
  });
}

/** Douglas-Peucker on a closed loop. The first point (start line) is always kept. */
function simplifyClosed(pts: Pt[], epsilon: number): Pt[] {
  const loop = [...pts, pts[0]];
  const keep = new Array<boolean>(loop.length).fill(false);
  keep[0] = keep[loop.length - 1] = true;
  // Split at the farthest point so the closed loop doesn't collapse.
  let far = 1;
  for (let i = 1; i < pts.length; i++) if (dist(pts[0], pts[i]) > dist(pts[0], pts[far])) far = i;
  keep[far] = true;
  const stack: [number, number][] = [
    [0, far],
    [far, loop.length - 1],
  ];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let maxD = 0;
    let idx = -1;
    for (let i = a + 1; i < b; i++) {
      const d = distToSegment(loop[i], loop[a], loop[b]);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (idx >= 0 && maxD > epsilon) {
      keep[idx] = true;
      stack.push([a, idx], [idx, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const ex = b[0] - a[0];
  const ey = b[1] - a[1];
  const len2 = ex * ex + ey * ey;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * ex + (p[1] - a[1]) * ey) / len2)) : 0;
  return Math.hypot(p[0] - (a[0] + ex * t), p[1] - (a[1] + ey * t));
}

function dist(a: Pt, b: Pt): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}
