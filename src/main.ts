import { Keyboard, LocalControls } from './game/input';
import { Camera } from './render/camera';
import { drawCar } from './render/drawCar';
import { drawHud, drawRacerStatus, drawTiming, drawToasts, Minimap, type Toast } from './render/hud';
import { eventToast } from './render/messages';
import { drawPitBoxes, drawPitStatus } from './render/pit';
import { TrackGraphics } from './render/trackGraphics';
import { RaceWorld, type PlayerInput, type WorldEvent } from './sim/world';
import { Track } from './track/track';
import { DEFAULT_TRACK, loadCustomTrack, TRACKS } from './tracks';

/** Fixed physics step. Rendering interpolates between steps. */
const DT = 1 / 120;
const ME = 'me';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;

// ?track=<id> picks a built-in track; ?track=custom loads the one saved by the editor.
const trackId = new URLSearchParams(location.search).get('track') ?? DEFAULT_TRACK;
const trackDef = (trackId === 'custom' ? loadCustomTrack() : TRACKS[trackId]) ?? TRACKS[DEFAULT_TRACK];
const track = new Track(trackDef);
const trackGfx = new TrackGraphics(track);
const minimap = new Minimap(track);
const world = new RaceWorld(track, { drsRule: 'free', wetness: 0 });
const me = world.addRacer(ME, 'You', '#e10600', 'medium');
const keyboard = new Keyboard(window);
const controls = new LocalControls(keyboard);
const camera = new Camera();
const toasts: Toast[] = [];

let dpr = 1;
function resize(): void {
  // Cap the resolution: drawing at 3x on high-DPI screens costs a lot for little gain.
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(window.innerWidth * dpr);
  canvas.height = Math.round(window.innerHeight * dpr);
}
window.addEventListener('resize', resize);
resize();

/** Put the car on the centreline nearest to it (or behind the start line), facing the right way. */
function resetCar(atStart: boolean): void {
  const ss = track.samples;
  let i = ss.length - 10;
  if (!atStart) i = track.query(me.car.x, me.car.y)?.index ?? i;
  const s = ss[i];
  me.car.place(s.x, s.y, Math.atan2(s.ty, s.tx));
  me.car.repair();
  camera.snap(s.x, s.y);
  me.timer.abortLap();
}
resetCar(true);

let last = performance.now();
let acc = 0;

function frame(now: number): void {
  const elapsed = Math.min((now - last) / 1000, 0.25);
  last = now;
  acc += elapsed;

  if (keyboard.wasPressed('KeyR')) resetCar(false);
  const inputs = new Map<string, PlayerInput>([[ME, controls.read()]]);
  while (acc >= DT) {
    for (const e of world.step(DT, inputs)) showEvent(e);
    acc -= DT;
  }

  render(acc / DT, elapsed);
  requestAnimationFrame(frame);
}

function showEvent(e: WorldEvent): void {
  if (e.racerId !== ME) return;
  const toast = eventToast(e, world.time);
  if (toast) toasts.push(toast);
  while (toasts.length > 3) toasts.shift();
}

function render(alpha: number, dt: number): void {
  const car = me.car;
  const x = car.prevX + (car.x - car.prevX) * alpha;
  const y = car.prevY + (car.y - car.prevY) * alpha;
  camera.follow(x, y, car.vx, car.vy, dt);

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = TrackGraphics.backgroundColor;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  camera.apply(ctx, canvas.width, canvas.height, dpr);
  trackGfx.draw(ctx, camera.bounds(canvas.width, canvas.height, dpr));
  drawPitBoxes(ctx, world);
  for (const r of world.racers) {
    const c = r.car;
    const rx = c.prevX + (c.x - c.prevX) * alpha;
    const ry = c.prevY + (c.y - c.prevY) * alpha;
    const heading = c.prevHeading + (c.heading - c.prevHeading) * alpha;
    drawCar(ctx, c.params, rx, ry, heading, c.steer * c.params.wheelAngleVisual, r.color);
  }

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const w = canvas.width / dpr;
  const h = canvas.height / dpr;
  minimap.draw(ctx, w, world.racers.map((r) => r.car));
  drawHud(ctx, car, track.name, w, h);
  drawRacerStatus(ctx, me, w, h);
  drawTiming(ctx, me.timer, world.time);
  drawPitStatus(ctx, world, me, w);
  drawToasts(ctx, toasts, world.time, w);
}

requestAnimationFrame(frame);
