import { Keyboard } from './game/input';
import { LapTimer, type TimingEvent } from './game/lapTimer';
import { Car } from './physics/car';
import { F1_CAR } from './physics/carParams';
import { Camera } from './render/camera';
import { drawCar } from './render/drawCar';
import { drawHud, drawTiming, drawToasts, formatLapTime, Minimap, type Toast } from './render/hud';
import { TrackGraphics } from './render/trackGraphics';
import { Track } from './track/track';
import { DEFAULT_TRACK, loadCustomTrack, TRACKS } from './tracks';

/** Fixed physics step. Rendering interpolates between steps. */
const DT = 1 / 120;

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;

// ?track=<id> picks a built-in track; ?track=custom loads the one saved by the editor.
const trackId = new URLSearchParams(location.search).get('track') ?? DEFAULT_TRACK;
const trackDef = (trackId === 'custom' ? loadCustomTrack() : TRACKS[trackId]) ?? TRACKS[DEFAULT_TRACK];
const track = new Track(trackDef);
const trackGfx = new TrackGraphics(track);
const minimap = new Minimap(track);
const car = new Car(F1_CAR, '#e10600');
const keyboard = new Keyboard(window);
const camera = new Camera();
const timer = new LapTimer(track);
const toasts: Toast[] = [];
/** Simulation clock (s): advances only in fixed physics steps. */
let simTime = 0;

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
  if (!atStart) i = track.query(car.x, car.y)?.index ?? i;
  const s = ss[i];
  car.place(s.x, s.y, Math.atan2(s.ty, s.tx));
  car.repair();
  camera.snap(s.x, s.y);
  timer.abortLap();
}
resetCar(true);

let last = performance.now();
let acc = 0;

function frame(now: number): void {
  const elapsed = Math.min((now - last) / 1000, 0.25);
  last = now;
  acc += elapsed;

  if (keyboard.wasPressed('KeyR')) resetCar(false);
  const input = keyboard.driverInput();
  while (acc >= DT) {
    car.step(input, DT, track);
    simTime += DT;
    for (const e of timer.update(simTime, DT, car)) showEvent(e);
    acc -= DT;
  }

  render(acc / DT, elapsed);
  requestAnimationFrame(frame);
}

function showEvent(e: TimingEvent): void {
  const until = simTime + 3;
  if (e.kind === 'lap') {
    const text = `${e.personalBest ? 'PERSONAL BEST  ' : ''}${formatLapTime(e.lap.time)}${e.lap.valid ? '' : '  (deleted)'}`;
    toasts.push({ text, color: e.personalBest ? '#b84dff' : e.lap.valid ? '#ffffff' : '#888', until });
  } else {
    const text = e.lapDeleted ? 'TRACK LIMITS: LAP TIME DELETED' : 'TRACK LIMITS';
    toasts.push({ text: `${text} (warning ${e.warnings})`, color: '#ffb347', until });
  }
  while (toasts.length > 3) toasts.shift();
}

function render(alpha: number, dt: number): void {
  const x = car.prevX + (car.x - car.prevX) * alpha;
  const y = car.prevY + (car.y - car.prevY) * alpha;
  const heading = car.prevHeading + (car.heading - car.prevHeading) * alpha;
  camera.follow(x, y, car.vx, car.vy, dt);

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = TrackGraphics.backgroundColor;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  camera.apply(ctx, canvas.width, canvas.height, dpr);
  trackGfx.draw(ctx, camera.bounds(canvas.width, canvas.height, dpr));
  drawCar(ctx, car.params, x, y, heading, car.steer * car.params.wheelAngleVisual, car.color);

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const w = canvas.width / dpr;
  const h = canvas.height / dpr;
  minimap.draw(ctx, w, [car]);
  drawHud(ctx, car, track.name, w, h);
  drawTiming(ctx, timer, simTime);
  drawToasts(ctx, toasts, simTime, w);
}

requestAnimationFrame(frame);
