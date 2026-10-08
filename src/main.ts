import { Keyboard } from './game/input';
import { Car } from './physics/car';
import { F1_CAR } from './physics/carParams';
import { Camera } from './render/camera';
import { drawCar } from './render/drawCar';
import { drawHud, Minimap } from './render/hud';
import { TrackGraphics } from './render/trackGraphics';
import { Track } from './track/track';
import testCircuit from './tracks/test-circuit.json';
import type { TrackDef } from './track/types';

/** Fixed physics step. Rendering interpolates between steps. */
const DT = 1 / 120;

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;

const track = new Track(testCircuit as TrackDef);
const trackGfx = new TrackGraphics(track);
const minimap = new Minimap(track);
const car = new Car(F1_CAR, '#e10600');
const keyboard = new Keyboard(window);
const camera = new Camera();

let dpr = 1;
function resize(): void {
  dpr = window.devicePixelRatio || 1;
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
  camera.snap(s.x, s.y, Math.atan2(s.ty, s.tx));
}
resetCar(true);

let last = performance.now();
let acc = 0;

function frame(now: number): void {
  const elapsed = Math.min((now - last) / 1000, 0.25);
  last = now;
  acc += elapsed;

  if (keyboard.wasPressed('KeyR')) resetCar(false);
  if (keyboard.wasPressed('KeyC')) camera.mode = camera.mode === 'chase' ? 'north' : 'chase';
  const input = keyboard.driverInput();
  while (acc >= DT) {
    car.step(input, DT, track);
    acc -= DT;
  }

  render(acc / DT, elapsed);
  requestAnimationFrame(frame);
}

function render(alpha: number, dt: number): void {
  const x = car.prevX + (car.x - car.prevX) * alpha;
  const y = car.prevY + (car.y - car.prevY) * alpha;
  const heading = car.prevHeading + (car.heading - car.prevHeading) * alpha;
  camera.follow(x, y, car.vx, car.vy, heading, dt);

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = TrackGraphics.backgroundColor;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  camera.apply(ctx, canvas.width, canvas.height, dpr);
  trackGfx.draw(ctx);
  drawCar(ctx, car.params, x, y, heading, car.steer * car.params.wheelAngleVisual, car.color);

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const w = canvas.width / dpr;
  const h = canvas.height / dpr;
  minimap.draw(ctx, w, [car]);
  drawHud(ctx, car, w, h);
}

requestAnimationFrame(frame);
