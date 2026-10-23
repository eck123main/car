import { gameAudio, loudestSurface } from '../audio/sound';
import { Keyboard, LocalControls, type Mouse } from '../game/input';
import type { ClientGame, Pose } from '../net/client';
import { HostGame } from '../net/host';
import type { NetInfo, SessionSnap } from '../net/protocol';
import { sessionSnap } from '../net/snapshot';
import { Camera } from '../render/camera';
import { drawDamage } from '../render/damage';
import { skinLivery } from '../cosmetics/skins';
import { drawCar } from '../render/drawCar';
import { drawCarEffects, drawDrops, drawItemBoxes, drawItemSlot, drawRockets, drawSmoke, drawTether, rainbowColor } from '../render/items';
import { ITEM_INFO } from '../sim/items';
import { drawBigDelta, drawHud, drawRacerStatus, drawTiming, drawToasts, Minimap, type Toast } from '../render/hud';
import { eventToast } from '../render/messages';
import { adviceFor, drawPitBoxes, drawPitStatus } from '../render/pit';
import { drawOwnPing } from '../render/ping';
import { drawRain } from '../render/rain';
import { drawSafetyCar } from '../render/safetyCar';
import { drawLights, drawNameTag, drawScreenTag, drawSessionBanner, drawSpectating, drawTower } from '../render/sessionHud';
import { TileCache } from '../render/tiles';
import { TrackGraphics } from '../render/trackGraphics';
import { RESET_WAIT, type SessionEvent } from '../sim/session';
import { settings } from './settings';
import { saveCam3d, savedCam3d, savedView, saveView } from './view';
import { liveryFor } from '../render/livery';
import type { Cam3d, CarView, View3D } from '../render3d/view3d';
import { cycle, isSpectating, watchable } from './spectate';
import type { ItemView } from '../sim/items';
import { RaceWorld, type PlayerInput, type Racer } from '../sim/world';
import type { Track } from '../track/track';

/** The camera jumps to the car when it is further behind than this (m). */
const CAMERA_SNAP_DISTANCE = 150;

/** Mouse driving: full steering lock when the cursor is this far off the car's heading (rad). */
const MOUSE_FULL_LOCK = (25 * Math.PI) / 180;
/** Mouse driving: no steering with the cursor this close to the car (m), where its angle jumps about. */
const MOUSE_DEAD_ZONE = 3;

/** Remembers the camera view (C) between games. */
const CAMERA_KEY = 'f1td.camera';

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
  /** Where to draw the safety car this frame, if it is out. */
  safetyCar(alpha: number): Pose | null;
  /** Party mode: item boxes and rockets to draw. */
  items?(): ItemView | null;
  /** Every player's connection to the host (online games). */
  net(): readonly NetInfo[];
  /** See-through cars to race against (time trial ghosts). */
  ghostCars?(): GhostCar[];
  /** Mode-specific HUD, drawn last (CSS px). */
  drawOverlay?(ctx: CanvasRenderingContext2D, width: number, height: number): void;
  /** Single player only: the menu truly pauses the game (online the race goes on). */
  readonly pausable?: boolean;
  /** Offers the 3D first-person view (V). Not in party mode yet. */
  readonly firstPerson?: boolean;
  /** Mode-specific keys, read once per frame. */
  handleKeys?(keyboard: Keyboard): void;
  /** The game screen closed: let go of anything still running (connections, timers). */
  dispose?(): void;
}

/** A replayed car: no physics, drawn see-through with a label. */
export interface GhostCar extends Pose {
  color: string;
  label: string;
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
  readonly firstPerson = true;
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
  safetyCar() {
    return null;
  }
  net() {
    return [];
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
    const i = atStart ? ss.length - 10 : (this.track.query(me.car.x, me.car.y, me.car.trackIndex)?.index ?? ss.length - 10);
    const s = ss[i];
    me.car.place(s.x, s.y, Math.atan2(s.ty, s.tx), i);
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
  safetyCar(alpha: number) {
    const sc = this.host.session?.safetyCar;
    if (!sc) return null;
    const dh = Math.atan2(Math.sin(sc.heading - sc.prevHeading), Math.cos(sc.heading - sc.prevHeading));
    return { x: sc.prevX + (sc.x - sc.prevX) * alpha, y: sc.prevY + (sc.y - sc.prevY) * alpha, heading: sc.prevHeading + dh * alpha };
  }
  constructor(private readonly host: HostGame) {}
  /** Not in party mode yet: the items aren't drawn in 3D. */
  get firstPerson() {
    return this.host.session?.settings.mode !== 'party';
  }
  items() {
    const s = this.host.session;
    return s?.items ? s.items.view(s.world.time) : null;
  }
  net() {
    return this.host.net;
  }
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
  /** Not in party mode yet: the items aren't drawn in 3D. */
  get firstPerson() {
    return this.client.session?.mode !== 'party';
  }
  net() {
    return this.client.net;
  }
  get meId() {
    return this.client.id ?? '';
  }
  get resetHint() {
    return resetHint(this.client.session?.phase);
  }
  recoverAt() {
    return this.client.session?.recovering.find(([id]) => id === this.meId)?.[1] ?? null;
  }
  safetyCar() {
    return this.client.session?.safetyCar ? this.client.safetyCarPose() : null;
  }
  items() {
    return this.client.itemView();
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
  private gfx: { track: Track; graphics: TrackGraphics; tiles: TileCache; minimap: Minimap } | null = null;
  private readonly toasts: Toast[] = [];
  private running = false;
  private paused = false;
  private last = 0;
  private acc = 0;
  private dpr = 1;
  private snapped = false;
  private lastPhase: string | null = null;
  /** Spectating: the driver being watched (null: our own car). */
  private watching: string | null = null;
  private ticker: Worker | null = null;
  /** Last frame's world-to-screen transform (device px), to find where the cursor points. */
  private worldToScreen: DOMMatrix | null = null;
  /** First-person view: wanted (V), and the 3D renderer once three.js has loaded. */
  private want3d = false;
  private view3d: View3D | null = null;
  private loading3d = false;
  private viewButtons: HTMLElement | null = null;
  private updateViewButtons: () => void = () => {};
  private offered3d = false;
  /** Called when the session phase changes (e.g. 'finished'). */
  onPhase: (phase: string) => void = () => {};
  /** Called on Esc. */
  onMenu: () => void = () => {};

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly keyboard: Keyboard,
    private readonly driver: GameDriver,
    mouse: Mouse | null = null,
  ) {
    this.ctx = canvas.getContext('2d')!;
    this.controls = new LocalControls(keyboard, mouse);
  }

  start(): void {
    this.running = true;
    try {
      if (localStorage.getItem(CAMERA_KEY) === 'rotate') this.camera.mode = 'rotate';
    } catch {
      // Storage blocked: stay on the default fixed view.
    }
    this.want3d = savedView() === '3d';
    this.addViewButtons();
    // Mouse driving carries on from the last race.
    if (this.controls.mouse?.active) this.canvas.style.cursor = 'crosshair';
    this.last = performance.now();
    window.addEventListener('resize', this.resize);
    document.addEventListener('visibilitychange', this.updateMute);
    this.resize();
    gameAudio().unlock();
    this.updateMute();
    requestAnimationFrame(this.frame);
    // Hidden tabs get no animation frames, but the race must go on (especially on the
    // host, which runs it for everyone). A worker timer keeps simulating meanwhile.
    this.ticker = startTicker(() => {
      if (document.hidden && this.running) this.simulate(performance.now());
    });
  }

  stop(): void {
    this.running = false;
    this.driver.dispose?.();
    this.ticker?.terminate();
    this.ticker = null;
    window.removeEventListener('resize', this.resize);
    document.removeEventListener('visibilitychange', this.updateMute);
    this.updateMute();
    this.canvas.style.cursor = '';
    this.close3d();
    this.viewButtons?.remove();
    this.viewButtons = null;
  }

  /**
   * Test buttons, bottom right: switch to the 3D view and change its camera. The 3D view is
   * still being tried out, so it isn't offered anywhere else yet.
   */
  private addViewButtons(): void {
    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;right:16px;bottom:16px;display:flex;gap:6px;';
    const button = (onClick: () => void) => {
      const b = document.createElement('button');
      b.tabIndex = -1;
      b.style.cssText = 'padding:6px 12px;font-size:12px;opacity:0.85;';
      // Never take focus: Space (DRS) and Enter (restart) would press it again.
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', onClick);
      box.append(b);
      return b;
    };
    // Camera list, opened by the Camera button (C still cycles through it).
    const list = document.createElement('div');
    list.style.cssText = 'position:absolute;right:0;bottom:calc(100% + 6px);display:none;flex-direction:column;gap:4px;';
    box.style.position = 'fixed';
    box.append(list);
    const showList = async () => {
      const open = list.style.display === 'none';
      list.replaceChildren();
      list.style.display = open ? 'flex' : 'none';
      if (!open || !this.view3d) return;
      const { CAM3D_ORDER, CAM3D_NAMES } = await import('../render3d/view3d');
      for (const c of CAM3D_ORDER) {
        const b = button(() => {
          this.setCam3d(c);
          list.style.display = 'none';
        });
        b.textContent = CAM3D_NAMES[c];
        b.style.textAlign = 'left';
        if (this.view3d?.mode === c) b.style.borderColor = '#ffd400';
        list.append(b);
      }
    };
    const cam = button(() => void showList());
    cam.textContent = 'Camera (C)';
    const view = button(() => this.toggleView());
    this.viewButtons = box;
    this.updateViewButtons = () => {
      box.style.display = this.driver.firstPerson ? 'flex' : 'none';
      view.textContent = this.want3d ? 'Map view (V)' : 'Test 3D view (V)';
      cam.style.display = this.want3d ? '' : 'none';
      list.style.display = 'none';
    };
    this.updateViewButtons();
    // Under the menus in #ui.
    this.canvas.after(box);
  }

  /** V: switch between the top-down map and the 3D first-person view. */
  private toggleView(): void {
    this.want3d = !this.want3d;
    saveView(this.want3d ? '3d' : 'top');
    if (!this.want3d) this.close3d();
    this.updateViewButtons();
    const text = this.want3d ? 'FIRST PERSON (test) · C: change camera · V: back to the map' : 'TOP-DOWN VIEW';
    this.toasts.push({ text, color: '#ffffff', until: this.driver.now() + 3 });
  }

  /** In 3D, C cycles through the cameras (CAM3D_ORDER). */
  private async cycleCam3d(): Promise<void> {
    if (!this.view3d) return;
    const { CAM3D_ORDER } = await import('../render3d/view3d');
    const i = CAM3D_ORDER.indexOf(this.view3d.mode);
    this.setCam3d(CAM3D_ORDER[(i + 1) % CAM3D_ORDER.length]);
  }

  private setCam3d(cam: Cam3d): void {
    if (!this.view3d) return;
    this.view3d.mode = cam;
    this.view3d.snap();
    saveCam3d(cam);
    void import('../render3d/view3d').then(({ CAM3D_NAMES }) =>
      this.toasts.push({ text: `CAMERA: ${CAM3D_NAMES[cam]}`, color: '#ffffff', until: this.driver.now() + 2 }),
    );
  }

  /** Load three.js and build the 3D track the first time the 3D view is wanted. */
  private open3d(track: Track): void {
    if (this.loading3d) return;
    this.loading3d = true;
    import('../render3d/view3d')
      .then(({ View3D, CAM3D_ORDER }) => {
        this.loading3d = false;
        if (!this.running || !this.want3d || !this.driver.firstPerson) return;
        const view = new View3D(track);
        const cam = savedCam3d();
        const found = CAM3D_ORDER.find((c) => c === cam);
        if (found) view.mode = found;
        // Under the 2D canvas, which keeps the HUD.
        Object.assign(view.canvas.style, { position: 'fixed', inset: '0', width: '100vw', height: '100vh' });
        this.canvas.style.position = 'relative';
        this.canvas.before(view.canvas);
        this.view3d = view;
        this.resize();
      })
      .catch((err: unknown) => {
        this.loading3d = false;
        this.want3d = false;
        this.updateViewButtons();
        console.error(err);
        this.toasts.push({ text: "Couldn't start the 3D view (WebGL off?)", color: '#ff6b6b', until: this.driver.now() + 4 });
      });
  }

  private close3d(): void {
    this.view3d?.dispose();
    this.view3d = null;
    this.canvas.style.position = '';
  }

  /** Sound only while the game is on screen and not paused. */
  private updateMute = (): void => {
    gameAudio().setMuted(!this.running || this.paused || document.hidden);
  };

  /** While paused the menu is open: inputs go idle but the race carries on (it's online). */
  setPaused(paused: boolean): void {
    this.paused = paused;
    this.updateMute();
  }

  /** C: switch between the fixed map and a map that turns so you always drive up. */
  private toggleCamera(): void {
    this.camera.mode = this.camera.mode === 'fixed' ? 'rotate' : 'fixed';
    try {
      localStorage.setItem(CAMERA_KEY, this.camera.mode);
    } catch {
      // Remembering the choice is a convenience only.
    }
    const text = this.camera.mode === 'rotate' ? 'CAMERA: ROTATING (you always drive up)' : 'CAMERA: FIXED MAP';
    this.toasts.push({ text, color: '#ffffff', until: this.driver.now() + 2 });
  }

  /**
   * Spectating (joined late, between qualifying runs, or finished): follow another driver,
   * and switch with the left/right keys. Otherwise follow our own car.
   */
  private updateSpectating(): void {
    const keys = { prev: ['ArrowLeft', 'KeyA'], next: ['ArrowRight', 'KeyD'] };
    let dir: 1 | -1 | 0 = 0;
    for (const k of keys.prev) if (this.keyboard.wasPressed(k)) dir = -1;
    for (const k of keys.next) if (this.keyboard.wasPressed(k)) dir = 1;
    const world = this.driver.world();
    const session = this.driver.session();
    if (!world || !session || !isSpectating(session, world, this.driver.meId)) {
      // (Steering presses while driving are not "switch driver" presses later.)
      this.watching = null;
      return;
    }
    const list = watchable(session, world, this.driver.meId);
    const before = this.watching;
    // Nobody watched yet, or they parked (finished, done or still waiting) or left: watch the
    // next car that's out on track.
    if (this.watching === null || !list.includes(this.watching)) this.watching = list[0] ?? null;
    else if (dir !== 0) this.watching = cycle(list, this.watching, dir);
    // Jump straight to the new car rather than sweeping across the map.
    if (this.watching !== before) this.snapped = false;
  }

  /** Mouse driving: steer towards the cursor, harder the further it is off the car's heading. */
  private mouseSteer(): number {
    const mouse = this.controls.mouse;
    const car = this.driver.world()?.racer(this.driver.meId)?.car;
    if (!mouse?.active || !car) return 0;
    // First person: the further the cursor is from the middle of the screen, the harder.
    if (this.view3d) return Math.max(-1, Math.min(1, (mouse.x - window.innerWidth / 2) / (window.innerWidth * 0.3)));
    if (!this.worldToScreen) return 0;
    const p = this.worldToScreen.inverse().transformPoint(new DOMPoint(mouse.x * this.dpr, mouse.y * this.dpr));
    const dx = p.x - car.x;
    const dy = p.y - car.y;
    if (Math.hypot(dx, dy) < MOUSE_DEAD_ZONE) return 0;
    const diff = Math.atan2(dy, dx) - car.heading;
    const off = Math.atan2(Math.sin(diff), Math.cos(diff));
    return Math.max(-1, Math.min(1, off / MOUSE_FULL_LOCK));
  }

  /** Say when mouse driving turns on or off, and show a crosshair while it's on. */
  private mouseChanged(): void {
    const mouse = this.controls.mouse;
    if (!mouse?.changed) return;
    mouse.changed = false;
    this.canvas.style.cursor = mouse.active ? 'crosshair' : '';
    const text = mouse.active
      ? 'MOUSE DRIVING: steer towards the cursor · left button throttle · right brake · middle DRS'
      : 'KEYBOARD DRIVING (click the track to drive with the mouse)';
    this.toasts.push({ text, color: '#ffffff', until: this.driver.now() + 3 });
    while (this.toasts.length > 3) this.toasts.shift();
  }

  private resize = (): void => {
    // Cap the resolution: drawing at 3x on high-DPI screens costs a lot for little gain.
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(window.innerWidth * this.dpr);
    this.canvas.height = Math.round(window.innerHeight * this.dpr);
    this.view3d?.setSize(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1);
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
    if (this.keyboard.wasPressed('KeyV') && this.driver.firstPerson) this.toggleView();
    if (this.keyboard.wasPressed('KeyM') && this.view3d) {
      this.view3d.mirror = !this.view3d.mirror;
      this.toasts.push({ text: this.view3d.mirror ? 'MIRROR ON' : 'MIRROR OFF', color: '#ffffff', until: this.driver.now() + 2 });
    }
    if (this.keyboard.wasPressed('KeyC')) {
      if (this.view3d) void this.cycleCam3d();
      else this.toggleCamera();
    }
    this.driver.handleKeys?.(this.keyboard);
    this.updateSpectating();
    this.controls.mouseSteer = this.mouseSteer();
    let input = this.controls.read();
    this.mouseChanged();
    // Nothing to keep in sync with: stop the clock while the menu is open.
    if (this.paused && this.driver.pausable) this.acc = 0;
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
    const { ctx, canvas } = this;
    const world = this.driver.world();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // The 3D view, when wanted and this game offers it (not party mode, which can be picked later).
    const offered = !!this.driver.firstPerson;
    if (offered !== this.offered3d) {
      this.offered3d = offered;
      if (!offered) this.close3d();
      this.updateViewButtons();
    }
    if (world && offered && this.want3d && !this.view3d) this.open3d(world.track);
    // First person: the 3D canvas underneath shows through; this one only carries the HUD.
    if (this.view3d) ctx.clearRect(0, 0, canvas.width, canvas.height);
    else {
      ctx.fillStyle = TrackGraphics.backgroundColor;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    if (!world) return;
    if (this.gfx?.track !== world.track) {
      // The track never changes during a session: draw it once into bitmap tiles.
      const graphics = new TrackGraphics(world.track, { scenery: true });
      this.gfx = { track: world.track, graphics, tiles: new TileCache((c, view) => graphics.draw(c, view)), minimap: new Minimap(world.track) };
      this.snapped = false;
    }
    const own = world.racer(this.driver.meId);
    // The car the camera and HUD follow: our own, or the one we're spectating.
    const me = (this.watching !== null ? world.racer(this.watching) : undefined) ?? own;
    if (!me) return;
    const poses = new Map(world.racers.map((r) => [r.id, this.driver.pose(r, alpha, dt)]));
    const myPose = poses.get(me.id)!;
    // Jump to the car (rather than sweep across the map) on a new car, or after the tab was
    // in the background and the camera fell far behind.
    if (!this.snapped || Math.hypot(this.camera.x - myPose.x, this.camera.y - myPose.y) > CAMERA_SNAP_DISTANCE) {
      this.camera.snap(myPose.x, myPose.y, myPose.heading);
      this.view3d?.snap();
      this.snapped = true;
    }
    this.camera.follow(myPose.x, myPose.y, me.car.vx, me.car.vy, myPose.heading, dt);
    const session = this.driver.session();
    const sc = this.driver.safetyCar(alpha);
    if (this.view3d) this.render3d(this.view3d, world, me, poses, session, sc, dt);
    else this.renderWorld(world, me, poses, session, sc);

    this.drawHudLayer(world, me, own, poses, session, sc, dt);
  }

  /** First person: our car (or the one we're watching) and everything else in 3D. */
  private render3d(view: View3D, world: RaceWorld, me: Racer, poses: ReadonlyMap<string, Pose>, session: SessionSnap | null, sc: Pose | null, dt: number): void {
    const carView = (r: Racer): CarView => {
      const p = poses.get(r.id)!;
      return {
        id: r.id,
        x: p.x,
        y: p.y,
        heading: p.heading,
        steer: r.car.steer,
        drsOpen: r.drsOpen,
        compound: r.tyres.compound,
        livery: skinLivery(r.skin) ?? liveryFor(r.color),
      };
    };
    // See-through, as in 2D: everyone in qualifying, and cars parked after finishing.
    const ghostly = (r: Racer) =>
      session?.phase === 'qualifying' || (r.frozen && (session?.phase === 'race' || session?.phase === 'finished')) || r.items.ghost > 0;
    const others = world.racers.filter((r) => r !== me).map((r) => ({ ...carView(r), ghost: ghostly(r) ? r.color : undefined }));
    // Hold Q to look behind.
    view.lookBack = !this.paused && this.keyboard.isDown(['KeyQ']);
    (this.driver.ghostCars?.() ?? []).forEach((g, i) =>
      others.push({ id: `ghost:${i}`, x: g.x, y: g.y, heading: g.heading, steer: 0, drsOpen: false, compound: me.tyres.compound, livery: liveryFor(g.color), ghost: g.color }),
    );
    view.render(
      {
        ...carView(me),
        speed: me.car.speed,
        yawRate: me.car.yawRate,
        wheel: {
          speedKmh: me.car.speed * 3.6,
          drsOpen: me.drsOpen,
          drsAvailable: me.drsHint === 'press',
          ers: me.ers,
          ersActive: me.ersActive,
          limiter: me.input.limiter,
        },
      },
      others,
      dt,
      sc && { ...sc, lights: session?.safetyCar === 'deployed' },
    );
  }

  /** 3D view: names over the other cars (up to 300 m away) and the safety car. */
  private drawTags3d(view: View3D, world: RaceWorld, me: Racer, poses: ReadonlyMap<string, Pose>, sc: Pose | null): void {
    const tags = world.racers.filter((r) => r !== me).map((r) => ({ ...poses.get(r.id)!, name: r.name, color: r.color }));
    if (sc) tags.push({ ...sc, name: 'SAFETY CAR', color: '#ffb000' });
    for (const t of tags) {
      const p = view.project(t.x, t.y, 1.8);
      if (p && p.distance < 300) drawScreenTag(this.ctx, t.name, p.x, p.y, t.color, p.distance);
    }
  }

  /** The top-down map: track, cars, items, safety car. */
  private renderWorld(world: RaceWorld, me: Racer, poses: ReadonlyMap<string, Pose>, session: SessionSnap | null, sc: Pose | null): void {
    const { ctx, canvas, dpr } = this;
    const gfx = this.gfx!;
    this.camera.apply(ctx, canvas.width, canvas.height, dpr);
    this.worldToScreen = ctx.getTransform();
    gfx.tiles.draw(ctx, this.camera.bounds(canvas.width, canvas.height, dpr), Camera.maxZoom() * dpr);
    drawPitBoxes(ctx, world);
    const items = this.driver.items?.() ?? null;
    if (items) {
      drawItemBoxes(ctx, items, this.driver.now());
      drawDrops(ctx, items, this.driver.meId, this.driver.now());
    }
    const ghosts = session?.phase === 'qualifying';
    // Time trial ghosts, under the real cars.
    for (const g of this.driver.ghostCars?.() ?? []) {
      ctx.globalAlpha = 0.45;
      drawCar(ctx, me.car.params, g.x, g.y, g.heading, 0, g.color, { drsOpen: false, compound: me.tyres.compound, rainLight: false, time: world.time });
      ctx.globalAlpha = 1;
      drawNameTag(ctx, g.label, g.x, g.y, g.color);
    }
    // No contact: cars passing through each other turn see-through (yours too) while they overlap.
    const passing = session?.noContact && session.phase !== 'qualifying' ? overlapping(world.racers, poses) : new Set<string>();
    // Draw other cars first so the local car is always on top.
    for (const r of [...world.racers.filter((r) => r !== me), me]) {
      const p = poses.get(r.id)!;
      // Ghosts: everyone in qualifying, and cars parked after finishing (others pass through them).
      const parked = r.frozen && (session?.phase === 'race' || session?.phase === 'finished');
      // Party mode ghosts are see-through too (faintly, to tell them apart).
      ctx.globalAlpha = r.items.ghost > 0 ? 0.3 : ((ghosts || parked) && r !== me) || passing.has(r.id) ? 0.45 : 1;
      const rainbow = r.items.star > 0;
      const paint = rainbow ? rainbowColor(this.driver.now(), r.id) : r.color;
      drawCar(ctx, r.car.params, p.x, p.y, p.heading, r.car.steer * r.car.params.wheelAngleVisual, paint, {
        livery: rainbow ? null : skinLivery(r.skin),
        drsOpen: r.drsOpen,
        compound: r.tyres.compound,
        rainLight: world.options.wetness >= 0.3,
        time: world.time,
      });
      ctx.globalAlpha = 1;
      if (items) drawCarEffects(ctx, r.items, p.x, p.y, this.driver.now());
      if (r !== me) drawNameTag(ctx, r.name, p.x, p.y, r.color);
    }
    if (items) {
      drawRockets(ctx, items, this.driver.now());
      for (const r of world.racers) {
        const hooker = r.items.hookedBy ? poses.get(r.items.hookedBy) : undefined;
        if (hooker && r.items.hooked > 0) drawTether(ctx, hooker, poses.get(r.id)!, ITEM_INFO.hook.color);
        const pulled = r.items.magnetTo ? poses.get(r.items.magnetTo) : undefined;
        if (pulled && r.items.magnet > 0) drawTether(ctx, poses.get(r.id)!, pulled, ITEM_INFO.magnet.color);
      }
      drawSmoke(ctx, items, this.driver.now());
    }
    if (sc) {
      drawSafetyCar(ctx, sc.x, sc.y, sc.heading, session?.safetyCar === 'deployed', this.driver.now());
      drawNameTag(ctx, 'SAFETY CAR', sc.x, sc.y, '#ffb000');
    }
  }

  /** Everything drawn in screen space over the world: minimap, timing, HUD, sound. */
  private drawHudLayer(world: RaceWorld, me: Racer, own: Racer | undefined, poses: ReadonlyMap<string, Pose>, session: SessionSnap | null, sc: Pose | null, dt: number): void {
    const { ctx, canvas, dpr } = this;
    const spectating = me !== own;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (this.view3d) this.drawTags3d(this.view3d, world, me, poses, sc);
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;
    const now = this.driver.now();
    drawRain(ctx, world.options.wetness, w, h, now);
    this.gfx!.minimap.draw(
      ctx,
      w,
      [
        ...world.racers.map((r) => {
          const p = poses.get(r.id)!;
          return { x: p.x, y: p.y, color: r.color };
        }),
        ...(sc ? [{ x: sc.x, y: sc.y, color: '#ffb000' }] : []),
      ],
    );
    const recoverAt = spectating ? null : this.driver.recoverAt();
    drawHud(ctx, me.car, world.track.name, w, h, spectating ? '' : this.driver.resetHint, recoverAt !== null ? recoverAt - now : null);
    drawDamage(ctx, me.car, w);
    const session2 = this.driver.session();
    const advice = adviceFor(world, me, session2);
    drawRacerStatus(ctx, me, w, h, advice);
    const delta = spectating ? null : this.driver.delta();
    drawTiming(ctx, me.timer, now, delta);
    if (settings().delta && delta !== null && me.timer.valid && me.timer.currentTime(now) !== null) drawBigDelta(ctx, delta, w, 52);
    gameAudio().update(
      {
        carId: me.id,
        x: me.car.x,
        y: me.car.y,
        speed: me.car.speed,
        throttle: me.car.throttle,
        brake: me.car.brake,
        sliding: me.car.sliding,
        surface: loudestSurface(me.car.surfaceFront, me.car.surfaceRear),
        drsOpen: me.drsOpen,
        drsAvailable: me.drsHint === 'press',
        ersActive: me.ersActive,
        limiter: me.input.limiter,
        stopped: me.car.retired || me.frozen,
        lights: session?.phase === 'lights' || session?.phase === 'grid' ? session.lights : 0,
      },
      dt,
    );
    if (session) {
      drawSessionBanner(ctx, session, own ?? me, now, w);
      if (spectating) drawSpectating(ctx, me.name, me.color, w);
      drawTower(ctx, session, world, me.id, this.driver.net());
      if (session.phase === 'lights' || session.phase === 'grid') drawLights(ctx, session.lights, w);
    }
    if (!spectating) drawPitStatus(ctx, world, me, w, advice);
    if (session?.mode === 'party' && !spectating) drawItemSlot(ctx, me.items.held, me.items.charges, w, now);
    drawToasts(ctx, this.toasts, now, w);
    this.driver.drawOverlay?.(ctx, w, h);
    // Our own ping, for players who joined (the host's is zero).
    drawOwnPing(ctx, this.driver.net().find((n) => n.id === this.driver.meId), w);
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

/** Cars whose bodies overlap another car's (or nearly), by their drawn poses. */
function overlapping(racers: readonly Racer[], poses: ReadonlyMap<string, { x: number; y: number; heading: number }>): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < racers.length; i++) {
    for (let j = i + 1; j < racers.length; j++) {
      const a = poses.get(racers[i].id)!;
      const b = poses.get(racers[j].id)!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const along = Math.abs(dx * Math.cos(a.heading) + dy * Math.sin(a.heading));
      const across = Math.abs(-dx * Math.sin(a.heading) + dy * Math.cos(a.heading));
      const p = racers[i].car.params;
      if (along < p.length + 0.5 && across < p.width + 0.4) {
        out.add(racers[i].id);
        out.add(racers[j].id);
      }
    }
  }
  return out;
}
