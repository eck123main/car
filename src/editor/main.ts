import { TrackGraphics } from '../render/trackGraphics';
import { parseTrackDef, trackFromGeoJson, trackToJson } from '../track/io';
import { Track } from '../track/track';
import type { TrackDef } from '../track/types';
import { CUSTOM_TRACK_KEY, TRACKS } from '../tracks';

type Pt = [number, number];

const AUTOSAVE_KEY = 'f1td.editor';
const HIT_RADIUS = 9;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('canvas');
const ctx = canvas.getContext('2d')!;
const nameInput = $<HTMLInputElement>('name');
const widthInput = $<HTMLInputElement>('width');
const pitSide = $<HTMLSelectElement>('pitSide');
const info = $<HTMLDivElement>('info');
const msg = $<HTMLDivElement>('msg');

let def: TrackDef = loadAutosave() ?? structuredClone(TRACKS.silverstone);
let preview: { track: Track; gfx: TrackGraphics } | null = null;
let selected = -1;
const history: string[] = [];

const view = { x: 0, y: 0, zoom: 1 };
const image = { el: null as HTMLImageElement | null, x: 0, y: 0, scale: 1, opacity: 0.5 };

type Drag =
  | { kind: 'point'; index: number; moved: boolean }
  | { kind: 'pan'; lastX: number; lastY: number }
  | { kind: 'image'; lastX: number; lastY: number };
let drag: Drag | null = null;
let spaceDown = false;
let dirty = true;
/** Rebuilding the track preview is slow-ish (~40 ms), so it is rate-limited while dragging. */
let previewStale = true;
let lastPreviewBuild = 0;

// ---------- State helpers

function snapshot(): void {
  history.push(JSON.stringify(def));
  if (history.length > 100) history.shift();
}

function undo(): void {
  const prev = history.pop();
  if (!prev) return say('Nothing to undo');
  def = JSON.parse(prev);
  selected = Math.min(selected, def.points.length - 1);
  changed();
}

function changed(): void {
  nameInput.value = def.name;
  widthInput.value = String(def.width);
  pitSide.value = def.pit?.side ?? '';
  previewStale = true;
  try {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(def));
  } catch {
    // Storage blocked: autosave is a convenience only.
  }
  dirty = true;
}

function rebuildPreview(): void {
  preview = null;
  if (def.points.length < 4) {
    info.textContent = `${def.points.length} points (need at least 4)`;
    return;
  }
  try {
    const track = new Track(def);
    preview = { track, gfx: new TrackGraphics(track) };
    const pit = track.pit ? `Pit lane: ${track.pit.side > 0 ? 'right' : 'left'}` : 'No room for a pit lane on the start straight';
    info.innerHTML = `${def.points.length} points<br>Lap length: ${(track.length / 1000).toFixed(2)} km<br>${pit}`;
  } catch {
    info.textContent = `${def.points.length} points (shape can't be built yet)`;
  }
}

function loadAutosave(): TrackDef | null {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    return raw ? parseTrackDef(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function say(text: string): void {
  msg.textContent = text;
}

function setDef(next: TrackDef): void {
  snapshot();
  def = next;
  selected = -1;
  changed();
  fitView();
}

// ---------- View

function resize(): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  dirty = true;
}

function fitView(): void {
  const pts = def.points;
  if (!pts.length) {
    view.x = view.y = 0;
    view.zoom = 1;
    return;
  }
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const rect = canvas.getBoundingClientRect();
  view.x = (minX + maxX) / 2;
  view.y = (minY + maxY) / 2;
  view.zoom = Math.min(rect.width / (maxX - minX + 120), rect.height / (maxY - minY + 120)) || 1;
  dirty = true;
}

function toScreen([x, y]: Pt): Pt {
  const rect = canvas.getBoundingClientRect();
  return [(x - view.x) * view.zoom + rect.width / 2, (y - view.y) * view.zoom + rect.height / 2];
}

function toWorld(sx: number, sy: number): Pt {
  const rect = canvas.getBoundingClientRect();
  return [(sx - rect.width / 2) / view.zoom + view.x, (sy - rect.height / 2) / view.zoom + view.y];
}

function pointAt(sx: number, sy: number): number {
  let best = -1;
  let bestD = HIT_RADIUS;
  def.points.forEach((p, i) => {
    const [px, py] = toScreen(p);
    const d = Math.hypot(px - sx, py - sy);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

/** Index of the control-polygon segment under the cursor (insert after it), or -1. */
function segmentAt(sx: number, sy: number): number {
  const n = def.points.length;
  if (n < 2) return -1;
  let best = -1;
  let bestD = HIT_RADIUS;
  for (let i = 0; i < n; i++) {
    const a = toScreen(def.points[i]);
    const b = toScreen(def.points[(i + 1) % n]);
    const d = distToSegment(sx, sy, a, b);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

function distToSegment(px: number, py: number, a: Pt, b: Pt): number {
  const ex = b[0] - a[0];
  const ey = b[1] - a[1];
  const len2 = ex * ex + ey * ey;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - a[0]) * ex + (py - a[1]) * ey) / len2)) : 0;
  return Math.hypot(px - (a[0] + ex * t), py - (a[1] + ey * t));
}

// ---------- Drawing

function draw(): void {
  if (previewStale && (!drag || performance.now() - lastPreviewBuild > 150)) {
    rebuildPreview();
    previewStale = false;
    lastPreviewBuild = performance.now();
    dirty = true;
  }
  if (!dirty) return;
  dirty = false;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rect = canvas.getBoundingClientRect();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = TrackGraphics.backgroundColor;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // World space.
  const z = view.zoom * dpr;
  ctx.setTransform(z, 0, 0, z, (rect.width / 2) * dpr - view.x * z, (rect.height / 2) * dpr - view.y * z);
  if (image.el) {
    ctx.globalAlpha = image.opacity;
    ctx.drawImage(image.el, image.x, image.y, image.el.width * image.scale, image.el.height * image.scale);
    ctx.globalAlpha = 1;
  }
  preview?.gfx.draw(ctx);

  // Screen space overlay: control polygon and points.
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const pts = def.points.map(toScreen);
  if (pts.length > 1) {
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);
  }
  pts.forEach(([x, y], i) => {
    ctx.beginPath();
    ctx.arc(x, y, i === 0 ? 7 : 5, 0, Math.PI * 2);
    ctx.fillStyle = i === selected ? '#ffd400' : i === 0 ? '#2ecc40' : '#ffffff';
    ctx.fill();
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  });
  if (pts.length > 1) drawArrow(pts[0], pts[1]);
}

function drawArrow(a: Pt, b: Pt): void {
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
  const len = 26;
  const tip: Pt = [a[0] + Math.cos(ang) * len, a[1] + Math.sin(ang) * len];
  ctx.strokeStyle = '#2ecc40';
  ctx.fillStyle = '#2ecc40';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(a[0], a[1]);
  ctx.lineTo(tip[0], tip[1]);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(tip[0], tip[1]);
  ctx.lineTo(tip[0] - Math.cos(ang - 0.5) * 9, tip[1] - Math.sin(ang - 0.5) * 9);
  ctx.lineTo(tip[0] - Math.cos(ang + 0.5) * 9, tip[1] - Math.sin(ang + 0.5) * 9);
  ctx.closePath();
  ctx.fill();
}

// ---------- Mouse & keyboard

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

canvas.addEventListener('mousedown', (e) => {
  const sx = e.offsetX;
  const sy = e.offsetY;
  if (e.button === 1 || (e.button === 0 && spaceDown)) {
    drag = { kind: 'pan', lastX: sx, lastY: sy };
    return;
  }
  if (e.button === 0 && e.altKey && image.el) {
    drag = { kind: 'image', lastX: sx, lastY: sy };
    return;
  }
  const hit = pointAt(sx, sy);
  if (e.button === 2) {
    if (hit >= 0) removePoint(hit);
    return;
  }
  if (e.button !== 0) return;
  snapshot();
  if (hit >= 0) {
    selected = hit;
    drag = { kind: 'point', index: hit, moved: false };
  } else {
    const seg = segmentAt(sx, sy);
    const at = seg >= 0 ? seg + 1 : selected >= 0 ? selected + 1 : def.points.length;
    def.points.splice(at, 0, toWorld(sx, sy));
    selected = at;
    drag = { kind: 'point', index: at, moved: true };
    changed();
  }
  dirty = true;
});

window.addEventListener('mousemove', (e) => {
  if (!drag) return;
  const rect = canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left;
  const sy = e.clientY - rect.top;
  if (drag.kind === 'point') {
    def.points[drag.index] = toWorld(sx, sy);
    drag.moved = true;
    changed();
  } else {
    const dx = (sx - drag.lastX) / view.zoom;
    const dy = (sy - drag.lastY) / view.zoom;
    drag.lastX = sx;
    drag.lastY = sy;
    if (drag.kind === 'pan') {
      view.x -= dx;
      view.y -= dy;
    } else {
      image.x += dx;
      image.y += dy;
    }
    dirty = true;
  }
});

window.addEventListener('mouseup', () => {
  // A click on an existing point that didn't move it shouldn't fill the undo history.
  if (drag?.kind === 'point' && !drag.moved) history.pop();
  drag = null;
});

canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const before = toWorld(e.offsetX, e.offsetY);
    view.zoom = Math.max(0.05, Math.min(40, view.zoom * Math.exp(-e.deltaY * 0.0015)));
    const after = toWorld(e.offsetX, e.offsetY);
    view.x += before[0] - after[0];
    view.y += before[1] - after[1];
    dirty = true;
  },
  { passive: false },
);

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  if (e.code === 'Space') {
    spaceDown = true;
    e.preventDefault();
  } else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') {
    e.preventDefault();
    undo();
  } else if ((e.code === 'Delete' || e.code === 'Backspace') && selected >= 0) {
    removePoint(selected);
  }
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') spaceDown = false;
});

function removePoint(i: number): void {
  snapshot();
  def.points.splice(i, 1);
  selected = -1;
  changed();
}

// ---------- Sidebar

nameInput.addEventListener('change', () => {
  snapshot();
  def.name = nameInput.value.trim() || 'Untitled';
  changed();
});

widthInput.addEventListener('change', () => {
  const w = Number(widthInput.value);
  if (!(w >= 6 && w <= 30)) return say('Width must be between 6 and 30 m');
  snapshot();
  def.width = w;
  changed();
});

// The pit lane goes along the start/finish straight; pick the side the real circuit uses.
pitSide.addEventListener('change', () => {
  snapshot();
  if (pitSide.value === 'left' || pitSide.value === 'right') def.pit = { side: pitSide.value };
  else delete def.pit;
  changed();
});

const builtin = $<HTMLSelectElement>('builtin');
for (const [id, t] of Object.entries(TRACKS)) builtin.add(new Option(t.name, id));
builtin.addEventListener('change', () => {
  const t = TRACKS[builtin.value];
  if (t) setDef(structuredClone(t));
  builtin.value = '';
});

$('new').addEventListener('click', () => setDef({ name: 'New Track', width: 13, points: [] }));

$('setStart').addEventListener('click', () => {
  if (selected <= 0) return say('Select a point first');
  snapshot();
  def.points = [...def.points.slice(selected), ...def.points.slice(0, selected)];
  selected = 0;
  changed();
});

$('reverse').addEventListener('click', () => {
  snapshot();
  // Keep the same start point, drive the other way.
  def.points = [def.points[0], ...def.points.slice(1).reverse()];
  changed();
});

$('applyScale').addEventListener('click', () => {
  const pct = Number($<HTMLInputElement>('scalePct').value);
  if (!(pct > 0)) return;
  snapshot();
  const [ox, oy] = def.points[0] ?? [0, 0];
  def.points = def.points.map(([x, y]) => [ox + (x - ox) * (pct / 100), oy + (y - oy) * (pct / 100)]);
  changed();
  fitView();
});

$('undo').addEventListener('click', undo);

function pickFile(input: HTMLInputElement, handler: (file: File) => void): void {
  input.onchange = () => {
    const file = input.files?.[0];
    input.value = '';
    if (file) handler(file);
  };
  input.click();
}

$('importJson').addEventListener('click', () =>
  pickFile($('fileJson'), async (file) => {
    try {
      setDef(parseTrackDef(JSON.parse(await file.text())));
      say(`Loaded ${file.name}`);
    } catch (err) {
      say(`Couldn't load: ${(err as Error).message}`);
    }
  }),
);

$('importGeo').addEventListener('click', () =>
  pickFile($('fileGeo'), async (file) => {
    try {
      const scale = Number($<HTMLInputElement>('geoScale').value) || 0.4;
      setDef(trackFromGeoJson(JSON.parse(await file.text()), scale, file.name.replace(/\.\w+$/, '')));
      say(`Imported ${file.name}. Check the start point and direction.`);
    } catch (err) {
      say(`Couldn't import: ${(err as Error).message}`);
    }
  }),
);

$('exportJson').addEventListener('click', () => {
  const blob = new Blob([trackToJson(def)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${def.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'track'}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});

$('copyJson').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(trackToJson(def));
    say('Copied to clipboard');
  } catch {
    say("Couldn't access the clipboard");
  }
});

$('loadImage').addEventListener('click', () =>
  pickFile($('fileImage'), (file) => {
    const img = new Image();
    img.onload = () => {
      image.el = img;
      image.x = view.x - (img.width * image.scale) / 2;
      image.y = view.y - (img.height * image.scale) / 2;
      dirty = true;
      say('Image loaded. Alt + drag to line it up, set metres/pixel to size it.');
    };
    img.src = URL.createObjectURL(file);
  }),
);
$('clearImage').addEventListener('click', () => {
  image.el = null;
  dirty = true;
});
$<HTMLInputElement>('imgScale').addEventListener('input', (e) => {
  const v = Number((e.target as HTMLInputElement).value);
  if (v > 0) image.scale = v;
  dirty = true;
});
$<HTMLInputElement>('imgOpacity').addEventListener('input', (e) => {
  image.opacity = Number((e.target as HTMLInputElement).value);
  dirty = true;
});

$('testDrive').addEventListener('click', () => {
  if (previewStale) rebuildPreview();
  if (!preview) return say('Track needs at least 4 points first');
  try {
    localStorage.setItem(CUSTOM_TRACK_KEY, JSON.stringify(def));
  } catch {
    return say("Couldn't save the track for test driving (storage blocked)");
  }
  window.open('./index.html?track=custom', '_blank');
});

// ---------- Start

window.addEventListener('resize', resize);
resize();
changed();
fitView();
(function loop() {
  draw();
  requestAnimationFrame(loop);
})();
