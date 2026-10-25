import { REAL_TRACK_IDS, TRACKS } from '../tracks';

/** Pieces of the welcome screen: a real circuit with a car lapping it, and the mode icons. */

const SVG = 'http://www.w3.org/2000/svg';

/** A smooth closed path through the centreline points (Catmull-Rom as cubic Béziers). */
function smoothPath(pts: [number, number][]): string {
  const n = pts.length;
  const p = (i: number) => pts[((i % n) + n) % n];
  let d = `M${p(0)[0].toFixed(1)},${p(0)[1].toFixed(1)}`;
  for (let i = 0; i < n; i++) {
    const [a, b, c, e] = [p(i - 1), p(i), p(i + 1), p(i + 2)];
    const c1 = [b[0] + (c[0] - a[0]) / 6, b[1] + (c[1] - a[1]) / 6];
    const c2 = [c[0] - (e[0] - b[0]) / 6, c[1] - (e[1] - b[1]) / 6];
    d += `C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${c[0].toFixed(1)},${c[1].toFixed(1)}`;
  }
  return d + 'Z';
}

function node<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, ...children: SVGElement[]): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  e.append(...children);
  return e;
}

/** Lobby colours for the pack of cars lapping the circuit (the first few of CAR_COLORS). */
const PACK = ['#e10600', '#ff8700', '#00d2be', '#1e5bff', '#ffd400'];

/** A circuit drawn as a glowing outline with a small pack of cars lapping it (still if the player prefers less motion). */
export function circuitSvg(id: string): SVGSVGElement {
  const def = TRACKS[id];
  const xs = def.points.map((p) => p[0]);
  const ys = def.points.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const size = Math.max(x1 - x0, y1 - y0);
  const pad = size * 0.08;
  const d = smoothPath(def.points);
  let length = 0;
  for (let i = 0; i < def.points.length; i++) {
    const [a, b] = [def.points[i], def.points[(i + 1) % def.points.length]];
    length += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  const w = size / 90;
  const pathId = `home-lap-${id}`;
  const svg = node('svg', {
    class: 'circuit',
    viewBox: `${x0 - pad} ${y0 - pad} ${x1 - x0 + 2 * pad} ${y1 - y0 + 2 * pad}`,
    'aria-hidden': 'true',
  });
  svg.append(
    node('path', { d, class: 'road-glow', 'stroke-width': w * 7 }),
    node('path', { id: pathId, d, class: 'road', 'stroke-width': w * 3.2 }),
    node('path', { d, class: 'road-line', 'stroke-width': w * 0.5 }),
  );
  // Start line across the track at the first point.
  const [s, t] = [def.points[0], def.points[1]];
  const ang = (Math.atan2(t[1] - s[1], t[0] - s[0]) * 180) / Math.PI;
  svg.append(node('rect', { x: -w * 0.4, y: -w * 2.2, width: w * 0.8, height: w * 4.4, class: 'start', transform: `translate(${s[0]} ${s[1]}) rotate(${ang})` }));
  if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return svg;
  // A lap shown sped up; each car a little slower than the one before, spread out at the start,
  // so the quicker ones catch and pass the others now and then.
  const base = Math.min(16, Math.max(9, length / 120));
  PACK.forEach((color, i) => {
    const dur = `${(base * (1 + i * 0.035)).toFixed(2)}s`;
    const begin = `${(-i * base * 0.09).toFixed(2)}s`;
    const trail = node('path', { d, class: 'trail', style: `color:${color}`, 'stroke-width': w * 1.8, pathLength: 100, 'stroke-dasharray': '3.5 96.5' });
    trail.append(node('animate', { attributeName: 'stroke-dashoffset', from: 3.5, to: -96.5, dur, begin, repeatCount: 'indefinite' }));
    const car = node('g', {}, node('rect', { x: -w * 1.6, y: -w * 0.8, width: w * 3.2, height: w * 1.6, rx: w * 0.5, class: 'car', style: `color:${color}` }));
    car.append(node('animateMotion', { dur, begin, repeatCount: 'indefinite', rotate: 'auto' }, node('mpath', { href: `#${pathId}` })));
    svg.append(trail, car);
  });
  return svg;
}

/** A random real circuit to start the showcase on. */
export function randomTrack(): string {
  return REAL_TRACK_IDS[Math.floor(Math.random() * REAL_TRACK_IDS.length)];
}

/** Simple line icons for the mode tiles (24 px grid, drawn with currentColor). */
const ICONS: Record<string, string> = {
  bots: '<rect x="5" y="8" width="14" height="11" rx="3"/><path d="M12 8V4M9 13h.01M15 13h.01M9 16.5h6"/><circle cx="12" cy="3.5" r="1"/>',
  party: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5V14M12 17h.01"/>',
  clock: '<circle cx="12" cy="13" r="7.5"/><path d="M12 13V9M10 2.5h4M18.5 6.5l1.5-1.5"/>',
  practice: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  garage: '<path d="M3 20V9l9-5 9 5v11M7 20v-6h10v6M7 17h10"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
};

export function icon(name: keyof typeof ICONS): HTMLElement {
  const i = document.createElement('i');
  i.className = 'icon';
  i.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;
  return i;
}
