import { Keyboard, LocalControls } from '../game/input';
import type { ClientGame, Pose } from '../net/client';
import { HostGame } from '../net/host';
import type { SessionSnap } from '../net/protocol';
import { sessionSnap } from '../net/snapshot';
import { Camera } from '../render/camera';
import { drawDamage } from '../render/damage';
import { drawCar } from '../render/drawCar';
import { drawHud, drawRacerStatus, drawTiming, drawToasts, Minimap, type Toast } from '../render/hud';
import { eventToast } from '../render/messages';
import { adviceFor, drawPitBoxes, drawPitStatus } from '../render/pit';
import { drawRain } from '../render/rain';
import { drawLights, drawNameTag, drawSessionBanner, drawTower } from '../render/sessionHud';
import { TrackGraphics } from '../render/trackGraphics';
import { RESET_WAIT, type SessionEvent } from '../sim/session';
import { RaceWorld, type PlayerInput, type Racer } from '../sim/world';
import type { Track } from '../track/track';

/** Fixed physics step, the same on every machine. Rendering interpolates between steps. */
export const DT = 1 / 120;

/** What the game screen needs from practice, host or client mode. */
export interface GameDriver {
  readonly meId: string;
  world(): RaceWorld | null;
  session(): SessionSnap | null;
  /** Clock for the HUD (session time). */
  now(): number;
  delta(): number | null;
  step(dt: number, input: PlayerInput): void;
  endFrame(): void;
  pose(r: Racer, alpha: number, dt: number): Pose;
  takeEvents(): SessionEvent[];
  /** Hint for the crashed-out overlay: what R does here. */
  readonly resetHint: string;
  /** When our car goes back on track after a reset, if it is waiting. */
  recoverAt(): number | null;
}

function lerpPose(r: Racer, alpha: number): Pose {
  const c = r.car;
  return {
    x: c.prevX + (c.x - c.prevX) * alpha,
    y: c.prevY + (c.y - c.prevY) * alpha,
    heading: c.prevHeading + (c.heading - c.prevHeading) * alpha,
  };
}

/** Free practice on one machine, no network. */
export class PracticeDriver implements GameDriver {
  readonly meId = 'me';
  readonly resetHint = 'Press R to get back on track (5 s wait)';
  private recovering: number | null = null;
  private readonly w: RaceWorld;
  private events: SessionEvent[] = [];

  constructor(
    private readonly track: Track,
    name: string,
  ) {
    this.w = new RaceWorld(track, { drsRule: 'free', wetness: 0 });
    this.w.addRacer(this.meId, name, '#e10600', 'medium');
    this.reset(true);
  }

  world() {
    return this.w;
  }
  session() {
    return null;
  }
  now() {
    return this.w.time;
  }
  delta() {
    const me = this.w.racer(this.meId)!;
    return me.timer.delta(this.w.time);
  }
  step(dt: number, input: PlayerInput) {
    const me = this.w.racer(this.meId)!;
    if (input.reset && this.recovering === null) {
      this.recovering = this.w.time + RESET_WAIT;
      me.frozen = true;
    }
    if (this.recovering !== null && this.w.time >= this.recovering) {
      this.recovering = null;
      me.frozen = false;
      this.reset();
    }
    this.events.push(...this.w.step(dt, new Map([[this.meId, input]])));
  }
  recoverAt() {
    return this.recovering;
  }
  endFrame() {}
  pose(r: Racer, alpha: number) {
    return lerpPose(r, alpha);
  }
  takeEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }

  /** Put the car on the centreline nearest to it (or behind the start line). */
  reset(atStart = false): void {
    const me = this.w.racer(this.meId)!;
    const ss = this.track.samples;
    const i = atStart ? ss.length - 10 : (this.track.query(me.car.x, me.car.y)?.index ?? ss.length - 10);
    const s = ss[i];
    me.car.place(s.x, s.y, Math.atan2(s.ty, s.tx));
    me.car.repair();
    me.timer.abortLap();
    me.pit.phase = 'out';
  }
}

/** The lobby owner: runs the real race. */
export class HostDriver implements GameDriver {
  readonly meId = HostGame.HOST_ID;
  get resetHint() {
    return resetHint(this.session()?.phase);
  }
  recoverAt() {
    return this.host.session?.recovering.get(this.meId) ?? null;
  }
  constructor(private readonly host: HostGame) {}
  world() {
    return this.host.session?.world ?? null;
  }
  session() {
    return this.host.session ? sessionSnap(this.host.session) : null;
  }
  now() {
    return this.host.session?.world.time ?? 0;
  }
  delta() {
    const w = this.world();
    return w?.racer(this.meId)?.timer.delta(w.time) ?? null;
  }
  step(dt: number, input: PlayerInput) {
    this.host.step(dt, input);
  }
  endFrame() {}
  pose(r: Racer, alpha: number) {
    return lerpPose(r, alpha);
  }
  takeEvents() {
    return this.host.takeEvents();
  }
}

/** Someone who joined a lobby. */
export class ClientDriver implements GameDriver {
  constructor(private readonly client: ClientGame) {}
  get meId() {
    return this.client.id ?? '';
  }
  get resetHint() {
    return resetHint(this.client.session?.phase);
  }
  recoverAt() {
    return this.client.session?.recovering.find(([id]) => id === this.meId)?.[1] ?? null;
  }
  world() {
    return this.client.world;
  }
  session() {
    return this.client.session;
  }
  now() {
    return this.client.serverTime();
  }
  delta() {
    return this.client.deltas.get(this.meId) ?? null;
  }
  step(dt: number, input: PlayerInput) {
    this.client.step(dt, input);
  }
  endFrame() {
    this.client.flush();
  }
  pose(r: Racer, _alpha: number, dt: number) {
    return this.client.pose(r.id, dt) ?? lerpPose(r, 1);
  }
  takeEvents() {
    return this.client.takeEvents();
  }
}

function resetHint(phase: string | undefined): string {
  if (phase === 'race') return 'Press R to get back on track (5 s wait)';
  if (phase === 'qualifying') return 'Press R to return to the pit exit (5 s wait; a timed lap is lost)';
  return 'Wait for the next session';
}

/** Draws the race and runs the fixed-step loop for whichever driver is active. */
export class GameScreen {
  private readonly ctx: CanvasRenderingContext2D;
  readonly controls: LocalControls;
  private readonly camera = new Camera();
  private gfx: { track: Track; graphics: TrackGraphics; minimap: Minimap } | null = null;
  private readonly toasts: Toast[] = [];
  private running = false;
  private paused = false;
  private last = 0;
  private acc = 0;
  private dpr = 1;
  private snapped = false;
  private lastPhase: string | null = null;
  private ticker: Worker | null = null;
  /** Called when the session phase changes (e.g. 'finished'). */
  onPhase: (phase: string) => void = () => {};
  /** Called on Esc. */
  onMenu: () => void = () => {};

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly keyboard: Keyboard,
    private readonly driver: GameDriver,
  ) {
    this.ctx = canvas.getContext('2d')!;
    this.controls = new LocalControls(keyboard);
  }

  start(): void {
    this.running = true;
    this.last = performance.now();
    window.addEventListener('resize', this.resize);
    this.resize();
    requestAnimationFrame(this.frame);
    // Hidden tabs get no animation frames, but the race must go on (especially on the
    // host, which runs it for everyone). A worker timer keeps simulating meanwhile.
    this.ticker = startTicker(() => {
      if (document.hidden && this.running) this.simulate(performance.now());
    });
  }

  stop(): void {
    this.running = false;
    this.ticker?.terminate();
    this.ticker = null;
    window.removeEventListener('resize', this.resize);
  }

  /** While paused the menu is open: inputs go idle but the race carries on (it's online). */
  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  private resize = (): void => {
    // Cap the resolution: drawing at 3x on high-DPI screens costs a lot for little gain.
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(window.innerWidth * this.dpr);
    this.canvas.height = Math.round(window.innerHeight * this.dpr);
  };

  private frame = (now: number): void => {
    if (!this.running) return;
    const elapsed = this.simulate(now);
    this.render(this.acc / DT, elapsed);
    requestAnimationFrame(this.frame);
  };

  /** Run physics steps up to `now` and handle events. Returns seconds simulated. */
  private simulate(now: number): number {
    const elapsed = Math.min((now - this.last) / 1000, 0.25);
    this.last = now;
    this.acc += elapsed;

    if (this.keyboard.wasPressed('Escape')) this.onMenu();
    let input = this.controls.read();
    const idle = { ...input, throttle: 0, brake: 0, steer: 0, drs: false, ers: false, reset: false };
    while (this.acc >= DT) {
      this.driver.step(DT, this.paused ? idle : input);
      // A key press is one event: only the first step of this frame sees it.
      input = { ...input, reset: false };
      this.acc -= DT;
    }
    this.driver.endFrame();

    const now2 = this.driver.now();
    for (const e of this.driver.takeEvents()) {
      if ('racerId' in e && e.racerId !== this.driver.meId) continue;
      const toast = eventToast(e, now2);
      if (toast) this.toasts.push(toast);
      while (this.toasts.length > 3) this.toasts.shift();
    }
    const phase = this.driver.session()?.phase ?? null;
    if (phase !== this.lastPhase) {
      this.lastPhase = phase;
      if (phase) this.onPhase(phase);
    }
    return elapsed;
  }

  private render(alpha: number, dt: number): void {
    const { ctx, canvas, dpr } = this;
    const world = this.driver.world();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = TrackGraphics.backgroundColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (!world) return;
    if (this.gfx?.track !== world.track) {
      this.gfx = { track: world.track, graphics: new TrackGraphics(world.track), minimap: new Minimap(world.track) };
      this.snapped = false;
    }
    const me = world.racer(this.driver.meId);
    if (!me) return;
    const poses = new Map(world.racers.map((r) => [r.id, this.driver.pose(r, alpha, dt)]));
    const myPose = poses.get(me.id)!;
    if (!this.snapped) {
      this.camera.snap(myPose.x, myPose.y);
      this.snapped = true;
    }
    this.camera.follow(myPose.x, myPose.y, me.car.vx, me.car.vy, dt);

    this.camera.apply(ctx, canvas.width, canvas.height, dpr);
    this.gfx.graphics.draw(ctx, this.camera.bounds(canvas.width, canvas.height, dpr));
    drawPitBoxes(ctx, world);
    const session = this.driver.session();
    const ghosts = session?.phase === 'qualifying';
    // Draw other cars first so the local car is always on top.
    for (const r of [...world.racers.filter((r) => r !== me), me]) {
      const p = poses.get(r.id)!;
      // Ghosts: everyone in qualifying, and cars parked after finishing (others pass through them).
      const parked = r.frozen && (session?.phase === 'race' || session?.phase === 'finished');
      ctx.globalAlpha = (ghosts || parked) && r !== me ? 0.45 : 1;
      drawCar(ctx, r.car.params, p.x, p.y, p.heading, r.car.steer * r.car.params.wheelAngleVisual, r.color, r.drsOpen);
      ctx.globalAlpha = 1;
      if (r !== me) drawNameTag(ctx, r.name, p.x, p.y, r.color);
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;
    const now = this.driver.now();
    drawRain(ctx, world.options.wetness, w, h, now);
    this.gfx.minimap.draw(
      ctx,
      w,
      world.racers.map((r) => {
        const p = poses.get(r.id)!;
        return { x: p.x, y: p.y, color: r.color };
      }),
    );
    const recoverAt = this.driver.recoverAt();
    drawHud(ctx, me.car, world.track.name, w, h, this.driver.resetHint, recoverAt !== null ? recoverAt - now : null);
    drawDamage(ctx, me.car, w);
    const session2 = this.driver.session();
    const advice = adviceFor(world, me, session2);
    drawRacerStatus(ctx, me, w, h, advice);
    drawTiming(ctx, me.timer, now, this.driver.delta());
    if (session) {
      drawSessionBanner(ctx, session, me, now, w);
      drawTower(ctx, session, world, me.id);
      if (session.phase === 'lights' || session.phase === 'grid') drawLights(ctx, session.lights, w);
    }
    drawPitStatus(ctx, world, me, w, advice);
    drawToasts(ctx, this.toasts, now, w);
  }
}

/** A worker that pings every ~16 ms. Worker timers keep running in background tabs. */
function startTicker(onTick: () => void): Worker | null {
  try {
    const src = 'setInterval(() => postMessage(0), 16);';
    const worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
    worker.onmessage = onTick;
    return worker;
  } catch {
    return null;
  }
}
