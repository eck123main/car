import type { CarClassId } from '../sim/carClass';
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
import { drawDebris } from '../render/debris';
import { drawCarEffects, drawDrops, drawItemBoxes, drawItemSlot, drawRockets, drawSmoke, drawTether, rainbowColor } from '../render/items';
import { ITEM_INFO, SMOKE_RADIUS } from '../sim/items';
import { drawBigDelta, drawHud, drawRacerStatus, drawTiming, drawToasts, Minimap, type Toast } from '../render/hud';
import { eventToast, radioLine, wheelNote } from '../render/messages';
import { adviceFor, boxCalled, drawPitBoxes, drawPitStatus } from '../render/pit';
import { drawPitOver, drawPitUnder } from '../render/pitCrew';
import { PitStops, type PitScene } from '../render/pitStops';
import { drawOwnPing } from '../render/ping';
import { drawRain } from '../render/rain';
import { drawSafetyCar } from '../render/safetyCar';
import { drawLights, drawNameTag, drawScreenTag, drawSessionBanner, drawSpectating, drawTower } from '../render/sessionHud';
import { TileCache } from '../render/tiles';
import { TrackGraphics } from '../render/trackGraphics';
import { RESET_WAIT, type SessionEvent } from '../sim/session';
import { settings, updateSettings } from './settings';
import { autoErs } from '../sim/autoErs';
import { idealLine } from '../sim/ai/idealLine';
import { drawIdealLine } from '../render/idealLine';
import { saveCam3d, savedCam3d, savedView, saveView } from './view';
import { liveryFor } from '../render/livery';
import type { Cam3d, CarView, View3D } from '../render3d/view3d';
import type { LedFlag, WheelInfo } from '../render3d/carModel';
import { slipAngle } from '../render3d/feel';
import { MOMENT_AFTER, MOMENT_BEFORE, MOMENT_SPEED, ReplayRecorder, type ReplayCar } from './replay';
import { tourShot, TvDirector } from '../render3d/tvCamera';
import { COMPOUNDS } from '../sim/tyres';
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
  /** Offers the 3D first-person view (V). */
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

/** The wheel doesn't call a pit stop for this long after a reset (s): the car was just repaired. */
const WHEEL_NO_BOX_AFTER_RESET = 30;
/** Stays on your own car this long after taking the flag (ms), hand in the air. */
const FINISH_WAVE = 4500;
/** How long the podium shows before the results (s). */
const PODIUM_TIME = 10;

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
    carClass: CarClassId = 'f1',
  ) {
    this.w = new RaceWorld(track, { drsRule: 'free', wetness: 0 });
    this.w.addRacer(this.meId, name, '#e10600', 'medium', carClass);
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
    const i = atStart ? ss.length - 10 : (this.track.locate(me.car.x, me.car.y, me.car.trackIndex) ?? me.car.trackIndex ?? ss.length - 10);
    const s = ss[i];
    me.car.place(s.x, s.y, Math.atan2(s.ty, s.tx), i);
    me.car.repair();
    // Alone on track, so the parts from the crash go too.
    this.w.debris = [];
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
  readonly firstPerson = true;
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
  readonly firstPerson = true;
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

const NO_WEBGL = "No 3D view in this browser: WebGL is off (turn on hardware acceleration in the browser's settings)";
/** The 3D view failed to start once on this page: don't keep trying. */
let webglFailed = false;
let webglChecked: boolean | null = null;

/** Can this browser draw 3D at all? Checked once (a tiny throwaway canvas). */
function webglWorks(): boolean {
  if (webglFailed) return false;
  if (webglChecked === null) {
    try {
      const c = document.createElement('canvas');
      webglChecked = !!(c.getContext('webgl2') ?? c.getContext('webgl'));
    } catch {
      webglChecked = false;
    }
  }
  return webglChecked;
}

/** Draws the race and runs the fixed-step loop for whichever driver is active. */
export class GameScreen {
  private readonly ctx: CanvasRenderingContext2D;
  readonly controls: LocalControls;
  private readonly camera = new Camera();
  private gfx: { track: Track; graphics: TrackGraphics; tiles: TileCache; minimap: Minimap } | null = null;
  /** Pit crews, animated from each car's pit phase. */
  private readonly pitStops = new PitStops();
  private readonly toasts: Toast[] = [];
  private running = false;
  private paused = false;
  private last = 0;
  private acc = 0;
  private dpr = 1;
  private snapped = false;
  private lastPhase: string | null = null;
  /** Latest short message for the 3D steering wheel's display. */
  private wheelNote: { text: string; color: string; until: number } | null = null;
  private greenUntil = 0;
  private noBoxUntil = 0;
  private waveUntil = 0;
  private finishPos = 0;
  /** The end of a 3D race: waiting for the wave to end, then the podium, results over it. */
  private podium: { startAt: number; t: number; shown: boolean; announced: boolean } | null = null;
  private recorder = new ReplayRecorder();
  private replay: { t: number; end: number; id: string; back: () => void; was3d: boolean; speed: number; tv: boolean; title: string } | null = null;
  private tv: TvDirector | null = null;
  /** Seconds into the fly-around before a race. */
  private tourTime = 0;
  /** Running order last looked at, for spotting overtakes; and each car's last upset. */
  private lastOrder: string[] = [];
  private orderCheckAt = 0;
  private readonly lastUpset = new Map<string, number>();
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
    this.want3d = savedView() === '3d' && webglWorks();
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
      const { CAM3D_ORDER, camNames } = await import('../render3d/view3d');
      const names = camNames(this.driver.world()?.racer(this.driver.meId)?.carClass);
      for (const c of CAM3D_ORDER) {
        const b = button(() => {
          this.setCam3d(c);
          list.style.display = 'none';
        });
        b.textContent = names[c];
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
    if (!this.want3d && !webglWorks()) {
      this.toast({ text: NO_WEBGL, color: '#ff6b6b', until: this.driver.now() + 5 });
      return;
    }
    this.want3d = !this.want3d;
    saveView(this.want3d ? '3d' : 'top');
    if (!this.want3d) this.close3d();
    this.updateViewButtons();
    const text = this.want3d ? 'FIRST PERSON (test) · C: change camera · V: back to the map' : 'TOP-DOWN VIEW';
    this.toast({ text, color: '#ffffff', until: this.driver.now() + 3 });
  }

  /** Show a message, replacing the same one if it is still up (so pressing a key again never stacks them). */
  private toast(t: Toast): void {
    const i = this.toasts.findIndex((o) => o.text === t.text);
    if (i >= 0) this.toasts.splice(i, 1);
    this.toasts.push(t);
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
    void import('../render3d/view3d').then(({ camNames }) =>
      this.toasts.push({ text: `CAMERA: ${camNames(this.driver.world()?.racer(this.driver.meId)?.carClass)[cam]}`, color: '#ffffff', until: this.driver.now() + 2 }),
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
        // Don't try again every game: back to the map, and V only explains why.
        webglFailed = true;
        saveView('top');
        this.updateViewButtons();
        console.error(err);
        this.toast({ text: NO_WEBGL, color: '#ff6b6b', until: this.driver.now() + 5 });
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
    // Just took the flag: stay in our own car for a moment.
    if (performance.now() < this.waveUntil) {
      this.watching = null;
      return;
    }
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
  /** Auto ERS / Auto DRS (Settings): the aids press Shift and Space for the player. */
  private driveAids(input: PlayerInput): PlayerInput {
    const { autoErs: ers, autoDrs: drs } = settings();
    if (!ers && !drs) return input;
    const world = this.driver.world();
    const me = world?.racer(this.driver.meId);
    if (!world || !me) return input;
    return {
      ...input,
      drs: input.drs || drs,
      ers: input.ers || (ers && autoErs(world.track, idealLine(world.track, undefined, me.carClass), me, input)),
    };
  }

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

    if (this.replay) {
      if (this.keyboard.wasPressed('Escape') || this.keyboard.wasPressed('Enter')) this.endReplay();
      else {
        const dir = this.keyboard.wasPressed('ArrowLeft') ? -1 : this.keyboard.wasPressed('ArrowRight') ? 1 : 0;
        const ids = this.driver.world()?.racers.map((r) => r.id) ?? [];
        if (dir !== 0) {
          this.replay.id = cycle(ids, this.replay.id, dir) ?? this.replay.id;
          this.view3d?.snap();
          this.tv?.cut();
        }
      }
    } else if (this.podiumShowing) {
      if (this.keyboard.wasPressed('Escape') || this.keyboard.wasPressed('Enter')) this.announcePodium();
    } else {
      if (this.keyboard.wasPressed('Escape')) this.onMenu();
      if (this.keyboard.wasPressed('KeyV') && this.driver.firstPerson) this.toggleView();
    }
    if (this.keyboard.wasPressed('KeyM') && this.view3d) {
      this.view3d.mirror = !this.view3d.mirror;
      this.toasts.push({ text: this.view3d.mirror ? 'MIRROR ON' : 'MIRROR OFF', color: '#ffffff', until: this.driver.now() + 2 });
    }
    if (this.keyboard.wasPressed('KeyL')) {
      updateSettings({ idealLine: !settings().idealLine });
      this.toasts.push({ text: settings().idealLine ? 'RACING LINE ON' : 'RACING LINE OFF', color: '#ffffff', until: this.driver.now() + 2 });
    }
    if (this.keyboard.wasPressed('KeyC')) {
      if (this.replay && this.replay.tv) this.replay.tv = false;
      else if (this.replay && this.view3d?.mode === 'far') {
        this.replay.tv = true;
        this.tv?.cut();
      } else if (this.view3d) void this.cycleCam3d();
      else this.toggleCamera();
    }
    this.driver.handleKeys?.(this.keyboard);
    this.updateSpectating();
    this.controls.mouseSteer = this.mouseSteer();
    let input = this.controls.read();
    input = this.driveAids(input);
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
      const note = wheelNote(e);
      if (note) this.wheelNote = { ...note, until: now2 + 2.5 };
      if (e.kind === 'lap' && !note) this.radioCall(now2);
      if (e.kind === 'safetyCar' && e.state === 'green') this.greenUntil = now2 + 4;
      if (e.kind === 'reset') this.noBoxUntil = now2 + WHEEL_NO_BOX_AFTER_RESET;
      if (e.kind === 'finished') {
        this.waveUntil = performance.now() + FINISH_WAVE;
        this.finishPos = e.position;
      }
      const toast = eventToast(e, now2);
      if (toast) this.toasts.push(toast);
      while (this.toasts.length > 3) this.toasts.shift();
    }
    const phase = this.driver.session()?.phase ?? null;
    if (phase !== this.lastPhase) {
      this.lastPhase = phase;
      if (phase) this.phaseChanged(phase);
    }
    this.updatePodium(elapsed);
    return elapsed;
  }

  /** Session moved on. In 3D the results wait for the wave and the podium. */
  private phaseChanged(phase: string): void {
    if (phase === 'finished' && this.view3d) {
      this.podium = { startAt: Math.max(performance.now(), this.waveUntil), t: 0, shown: false, announced: false };
      return;
    }
    if (phase !== 'finished') {
      // A new weekend: whatever was showing from the last one goes.
      if (this.replay) this.endReplay(false);
      if (this.podium) this.endPodium();
      // Play again restarts the race clock: nothing from the last race carries over.
      if (phase === 'qualifying' || phase === 'grid') {
        this.recorder = new ReplayRecorder();
        this.view3d?.clearRubber();
        this.lastOrder = [];
        this.lastUpset.clear();
        this.tourTime = 0;
      }
    }
    this.onPhase(phase);
  }

  private endPodium(): void {
    this.podium = null;
    this.view3d?.endPodium();
  }

  private updatePodium(elapsed: number): void {
    const p = this.podium;
    if (!p || this.replay) return;
    if (performance.now() < p.startAt) return;
    if (!this.view3d) {
      // The 3D view was closed: straight to the results.
      this.podium = null;
      if (!p.announced) this.onPhase('finished');
      return;
    }
    p.t += elapsed;
    if (!p.announced && p.t > PODIUM_TIME) this.announcePodium();
  }

  private announcePodium(): void {
    if (!this.podium || this.podium.announced) return;
    this.podium.announced = true;
    this.onPhase('finished');
  }

  /** The podium is up and nobody has seen the results yet. */
  private get podiumShowing(): boolean {
    return !!this.podium && !this.podium.announced && performance.now() >= this.podium.startAt;
  }

  /** The top three, from the final standings. */
  private podiumRacers(world: RaceWorld, session: SessionSnap | null): Racer[] {
    const ids = (session?.standings ?? []).filter((s) => s.status !== 'dnf').map((s) => s.id);
    return ids.map((id) => world.racer(id)).filter((r): r is Racer => !!r).slice(0, 3);
  }

  private renderPodium(view: View3D, world: RaceWorld, session: SessionSnap | null, dt: number): void {
    const p = this.podium!;
    const top = this.podiumRacers(world, session);
    if (top.length === 0) {
      this.announcePodium();
      return;
    }
    if (!p.shown) {
      p.shown = true;
      view.showPodium(top.map((r) => r.color));
    }
    view.aimPodium(p.t);
    view.setRace({ lights: 0, wetness: world.options.wetness, progress: 1, phase: 'podium' });
    const spots = view.podiumPlaces();
    const cars = top.map((r, i): CarView => ({
      id: r.id,
      x: spots[i].x,
      y: spots[i].y,
      heading: spots[i].heading,
      steer: 0,
      drsOpen: false,
      compound: r.tyres.compound,
      livery: skinLivery(r.skin) ?? liveryFor(r.color),
      trackIndex: null,
      lost: r.car.lost,
      parts: r.car.parts,
      lift: spots[i].lift,
    }));
    const still = { speedKmh: 0, drsOpen: false, drsAvailable: false, ers: 0, ersActive: false, limiter: false };
    view.render({ ...cars[0], speed: 0, yawRate: 0, wheel: still }, cars.slice(1), dt);

    const { ctx, canvas, dpr } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    top.forEach((r, i) => {
      const at = view.project(spots[i].x, spots[i].y, spots[i].lift + 1.9);
      if (at) drawScreenTag(ctx, `P${i + 1}  ${r.name}`, at.x, at.y, r.color, 0);
    });
    if (!p.announced) {
      ctx.font = '14px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffffff';
      ctx.fillText('ENTER: results', canvas.width / dpr / 2, canvas.height / dpr - 24);
    }
  }

  /** Is there a race to watch again? */
  canReplay(): boolean {
    return this.recorder.hasData;
  }

  /** Watch the last lap again in 3D; `back` is called when it ends. */
  startReplay(back: () => void): void {
    const world = this.driver.world();
    const standings = this.driver.session()?.standings ?? [];
    const id = world?.racer(this.driver.meId) ? this.driver.meId : standings[0]?.id;
    if (!id || !this.recorder.hasData) {
      back();
      return;
    }
    const finished = standings.find((s) => s.id === id)?.status === 'finished';
    this.replay = { t: this.recorder.lastLapStart(id, finished), end: this.recorder.range[1], id, back, was3d: this.want3d, speed: 1, tv: true, title: 'REPLAY' };
    this.want3d = true;
    this.tv = null;
    this.view3d?.endPodium();
    this.view3d?.snap();
  }

  /** Stop the replay (back: return to the screen it came from). */
  private endReplay(back = true): void {
    const r = this.replay;
    if (!r) return;
    this.replay = null;
    this.view3d?.setShot(null);
    this.want3d = r.was3d;
    if (!r.was3d) {
      this.close3d();
      // No 3D, so no podium to go back to.
      this.podium = null;
    } else if (this.podium) this.podium.shown = false;
    if (back) r.back();
  }

  private recordReplay(world: RaceWorld, poses: ReadonlyMap<string, Pose>): void {
    const time = world.time;
    const cars: [string, ReplayCar][] = world.racers.map((r) => {
      const p = poses.get(r.id)!;
      this.recorder.noteLaps(time, r.id, r.timer.lapsCompleted);
      return [
        r.id,
        {
          x: p.x,
          y: p.y,
          heading: p.heading,
          steer: r.car.steer,
          speed: r.car.speed,
          brake: r.car.brake,
          throttle: r.car.throttle,
          slip: slipAngle(r.car.vx, r.car.vy, r.car.heading),
          yawRate: r.car.yawRate,
          drs: r.drsOpen,
          ers: r.ers,
          ersOn: r.ersActive,
          lost: r.car.lost,
          trackIndex: r.car.trackIndex,
          upset: r.car.upset,
          gear: r.car.gear,
          revs: r.car.revs,
        },
      ];
    });
    this.recorder.record(time, cars);
    this.noteMoments(world, poses, time);
  }

  /** Look for overtakes (four times a second) and big hits, for "Best moment". */
  private noteMoments(world: RaceWorld, poses: ReadonlyMap<string, Pose>, time: number): void {
    for (const r of world.racers) {
      const before = this.lastUpset.get(r.id) ?? 0;
      if (r.car.upset - before > 0.3) this.recorder.noteMoment(time, r.id, 3 + r.car.upset * 4);
      this.lastUpset.set(r.id, r.car.upset);
    }
    if (time < this.orderCheckAt) return;
    this.orderCheckAt = time + 0.25;
    const standings = this.driver.session()?.standings ?? [];
    const order = standings.map((s) => s.id);
    const was = this.lastOrder;
    this.lastOrder = order;
    if (was.length !== order.length) return;
    for (let i = 0; i + 1 < order.length; i++) {
      const passer = order[i];
      const passed = order[i + 1];
      if (was.indexOf(passer) <= was.indexOf(passed)) continue;
      const a = world.racer(passer);
      const b = world.racer(passed);
      const pa = poses.get(passer);
      const pb = poses.get(passed);
      // A real pass on track: both out there, side by side (not someone stopping in the pits).
      if (!a || !b || !pa || !pb || a.pit.phase !== 'out' || b.pit.phase !== 'out' || a.frozen || b.frozen || a.car.retired || b.car.retired) continue;
      if (Math.hypot(pa.x - pb.x, pa.y - pb.y) > 25) continue;
      // Up front counts for more, and yours most of all.
      this.recorder.noteMoment(time, passer, 6 + (order.length - i) * 0.5 + (passer === this.driver.meId ? 4 : 0));
    }
  }

  /** Did the race have a moment worth seeing again? */
  hasMoment(): boolean {
    return this.recorder.bestMoment() !== null;
  }

  /** The best moment again, in slow motion, on the TV cameras. */
  startMoment(back: () => void): void {
    const m = this.recorder.bestMoment();
    if (!m) {
      back();
      return;
    }
    this.replay = { t: m.time - MOMENT_BEFORE, end: m.time + MOMENT_AFTER, id: m.id, back, was3d: this.want3d, speed: MOMENT_SPEED, tv: true, title: 'BEST MOMENT' };
    this.want3d = true;
    this.view3d?.endPodium();
    this.tv = null;
  }

  private renderReplay(world: RaceWorld, dt: number): void {
    const r = this.replay!;
    const view = this.view3d;
    const { ctx, canvas, dpr } = this;
    const w = canvas.width / dpr;
    const step = dt * r.speed;
    if (view) {
      r.t += step;
      if (r.t >= r.end) {
        this.endReplay();
        return;
      }
      const toView = (racer: Racer, c: ReplayCar): CarView => ({
        id: racer.id,
        x: c.x,
        y: c.y,
        heading: c.heading,
        steer: c.steer,
        drsOpen: c.drs,
        compound: racer.tyres.compound,
        livery: skinLivery(racer.skin) ?? liveryFor(racer.color),
        body: racer.carClass,
        trackIndex: c.trackIndex,
        lost: c.lost,
        speed: c.speed,
        brake: c.brake,
        throttle: c.throttle,
        slip: c.slip,
        upset: c.upset,
      });
      const main = world.racer(r.id);
      const c = this.recorder.sample(r.id, r.t);
      if (main && c) {
        const others: CarView[] = [];
        for (const o of world.racers) {
          const s = o === main ? null : this.recorder.sample(o.id, r.t);
          if (s) others.push(toView(o, s));
        }
        view.setRace({ lights: 0, wetness: world.options.wetness, progress: 1, phase: 'replay' });
        // TV cameras cut between shots; C goes through the cameras on the car too.
        if (r.tv) {
          this.tv ??= new TvDirector(world.track, (x, y, i) => view.heightAt(x, y, i ?? null));
          view.setShot(this.tv.step(c.x, c.y, c.heading, c.trackIndex, step));
        } else view.setShot(null);
        view.render(
          {
            ...toView(main, c),
            speed: c.speed,
            yawRate: c.yawRate,
            wheel: { speedKmh: c.speed * 3.6, gear: c.gear, revs: c.revs, drsOpen: c.drs, drsAvailable: false, ers: c.ers, ersActive: c.ersOn, limiter: false, throttle: c.throttle, tyre: COMPOUNDS[main.tyres.compound].name[0], wear: main.tyres.wear },
          },
          others,
          step,
        );
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        for (const o of world.racers) {
          const s = o === main ? null : this.recorder.sample(o.id, r.t);
          const at = s && view.project(s.x, s.y, 1.8, s.trackIndex);
          if (at && at.distance < 300) drawScreenTag(ctx, o.name, at.x, at.y, o.color, at.distance);
        }
      }
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const name = world.racer(r.id)?.name ?? '';
    const text = view ? `${r.title} · ${name} · ← → change car · C camera · ENTER back` : 'Loading the replay…';
    ctx.font = 'bold 14px system-ui, sans-serif';
    ctx.textAlign = 'center';
    const tw = ctx.measureText(text).width + 24;
    ctx.fillStyle = 'rgba(10,12,16,0.75)';
    ctx.fillRect(w / 2 - tw / 2, 12, tw, 28);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, w / 2, 31);
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
    if (this.replay) {
      this.renderReplay(world, dt);
      return;
    }
    if (this.podium && this.view3d && performance.now() >= this.podium.startAt) {
      this.renderPodium(this.view3d, world, this.driver.session(), dt);
      return;
    }
    const own = world.racer(this.driver.meId);
    // The car the camera and HUD follow: our own, or the one we're spectating.
    const me = (this.watching !== null ? world.racer(this.watching) : undefined) ?? own;
    if (!me) return;
    const poses = new Map(world.racers.map((r) => [r.id, this.driver.pose(r, alpha, dt)]));
    if (this.driver.session()?.phase === 'race') this.recordReplay(world, poses);
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
    if (this.view3d) this.render3d(this.view3d, world, me, own, poses, session, sc, dt);
    else this.renderWorld(world, me, poses, session, sc);

    this.drawHudLayer(world, me, own, poses, session, sc, dt);
  }

  /** This frame's pit stops (crews, lights, smoke), for either view. */
  private pitScene(world: RaceWorld, poses: ReadonlyMap<string, Pose>): PitScene {
    this.pitStops.update(world);
    return this.pitStops.scene(world, poses);
  }

  /** The engineer's line as a lap ends, on the wheel. */
  private radioCall(now: number): void {
    const session = this.driver.session();
    const me = this.driver.world()?.racer(this.driver.meId);
    const list = session?.standings;
    if (session?.phase !== 'race' || !me || !list) return;
    const i = list.findIndex((s) => s.id === me.id);
    if (i < 0) return;
    const gap = (a?: number | null, b?: number | null) => (a == null || b == null ? null : Math.abs(a - b));
    const text = radioLine({
      position: i + 1,
      gapAhead: i > 0 ? gap(list[i - 1].gap ?? 0, list[i].gap ?? 0) : null,
      gapBehind: i + 1 < list.length ? gap(list[i + 1].gap, list[i].gap ?? 0) : null,
      lapsLeft: session.laps - me.timer.lapsCompleted,
      wear: me.tyres.wear,
    });
    this.wheelNote = { text, color: '#7fd8ff', until: now + 3 };
  }

  /** What the wheel display flashes: the latest note, or BOX while the engineer wants a stop. */
  private wheelMessage(world: RaceWorld, me: Racer, session: SessionSnap | null): WheelInfo['message'] {
    const now = this.driver.now();
    if (performance.now() < this.waveUntil) return { text: `P${this.finishPos}`, color: this.finishPos === 1 ? '#ffd400' : '#ffffff' };
    if (this.wheelNote && now < this.wheelNote.until) return this.wheelNote;
    // Same call as the HUD's banner (only near the pit entry), and never straight after a reset.
    if (session?.phase === 'race' && now >= this.noBoxUntil && boxCalled(world, me, adviceFor(world, me, session)) && Math.floor(now * 2) % 2 === 0) return { text: 'BOX', color: '#ffd400' };
    return null;
  }

  /** Flags on the shift lights: yellow under the safety car, green for a moment at the restart. */
  private wheelFlag(session: SessionSnap | null): LedFlag {
    if (session?.safetyCar === 'deployed' || session?.safetyCar === 'inThisLap') return 'yellow';
    return this.driver.now() < this.greenUntil ? 'green' : null;
  }

  /** How far through the race the leader is (0-1). */
  private raceProgress(world: RaceWorld, session: SessionSnap | null): number {
    if (!session) return 0;
    if (session.phase === 'finished') return 1;
    if (session.phase !== 'race' || session.laps <= 0) return 0;
    const leader = session.standings[0];
    const r = leader && world.racer(leader.id);
    if (!r) return 0;
    return Math.min(1, (r.timer.lapsCompleted + (r.timer.lapDistance ?? 0) / world.track.length) / session.laps);
  }

  /** First person: our car (or the one we're watching) and everything else in 3D. */
  private render3d(view: View3D, world: RaceWorld, me: Racer, own: Racer | undefined, poses: ReadonlyMap<string, Pose>, session: SessionSnap | null, sc: Pose | null, dt: number): void {
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
        body: r.carClass,
        trackIndex: r.car.trackIndex,
        lost: r.car.lost,
        parts: r.car.parts,
        speed: r.car.speed,
        brake: r.car.brake,
        throttle: r.car.throttle,
        slip: slipAngle(r.car.vx, r.car.vy, r.car.heading),
        wear: r.tyres.wear,
        upset: r.car.upset,
        color: r.color,
      };
    };
    // See-through, as in 2D: everyone in qualifying, and cars parked after finishing.
    const ghostly = (r: Racer) => session?.phase === 'qualifying' || (r.frozen && (session?.phase === 'race' || session?.phase === 'finished'));
    // Party mode's ghost item: nearly invisible to everyone else, see-through to its driver.
    const look = (r: Racer): Partial<CarView> =>
      r.items.ghost > 0 ? { ghost: GHOST_ITEM_TINT, ghostOpacity: r === me ? 0.28 : 0.12 } : { ghost: r !== me && ghostly(r) ? r.color : undefined };
    const others = world.racers.filter((r) => r !== me).map((r) => ({ ...carView(r), ...look(r) }));
    // Hold Q to look behind.
    view.lookBack = !this.paused && this.keyboard.isDown(['KeyQ']);
    view.showIdealLine(settings().idealLine ? idealLine(world.track, undefined, me.carClass) : null);
    const flag = this.wheelFlag(session);
    const leader = session?.standings[0];
    view.setRace({
      lights: session?.phase === 'lights' ? session.lights : 0,
      wetness: world.options.wetness,
      flag,
      // Out from the leader's last lap, so the winner sees it coming.
      chequered: session?.phase === 'finished' || (session?.phase === 'race' && !!leader && leader.laps >= session.laps - 1),
      phase: session?.phase,
      progress: this.raceProgress(world, session),
    });
    // Before the start: fly round the circuit until the player is ready.
    if (session?.phase === 'grid' && !this.controls.ready) {
      this.tourTime += dt;
      view.setShot(tourShot(world.track, this.tourTime, (x, y) => view.heightAt(x, y)));
    } else if (this.tourTime > 0) {
      this.tourTime = 0;
      view.setShot(null);
    }
    view.showDebris(
      world.debris,
      (id) => {
        const r = world.racer(id);
        return skinLivery(r?.skin) ?? liveryFor(r?.color ?? '#888888');
      },
      world.time,
      dt,
      (id) => world.racer(id)?.carClass ?? 'f1',
    );
    (this.driver.ghostCars?.() ?? []).forEach((g, i) =>
      others.push({ id: `ghost:${i}`, x: g.x, y: g.y, heading: g.heading, steer: 0, drsOpen: false, compound: me.tyres.compound, livery: liveryFor(g.color), ghost: g.color, body: me.carClass }),
    );
    const items = this.driver.items?.() ?? null;
    view.render(
      {
        ...carView(me),
        ...look(me),
        speed: me.car.speed,
        yawRate: me.car.yawRate,
        // Camera movement and wheel vibration only when the player turns them on.
        headMoves: settings().headMotion,
        feel: {
          longG: me.car.longG,
          latG: me.car.latG,
          speed: me.car.speed,
          surface: loudestSurface(me.car.surfaceFront, me.car.surfaceRear),
          upset: me.car.upset,
        },
        wheel: {
          speedKmh: me.car.speed * 3.6,
          gear: me.car.gear,
          revs: me.car.revs,
          drsOpen: me.drsOpen,
          drsAvailable: me.drsHint === 'press',
          ers: me.ers,
          ersActive: me.ersActive,
          limiter: me.input.limiter,
          throttle: me.car.throttle,
          tcLevel: me.input.tc ?? 2,
          tc: me.car.tcActive,
          tyre: COMPOUNDS[me.tyres.compound].name[0],
          wear: me.tyres.wear,
          delta: me === own ? this.driver.delta() : null,
          message: this.wheelMessage(world, me, session),
          flag,
          celebrate: me === own && performance.now() < this.waveUntil ? (this.finishPos === 1 ? 'win' : 'wave') : null,
        },
      },
      others,
      dt,
      sc && { ...sc, lights: session?.safetyCar === 'deployed' },
      items && {
        view: items,
        viewer: this.driver.meId,
        cars: world.racers.map((r) => ({ ...poses.get(r.id)!, id: r.id, trackIndex: r.car.trackIndex, state: r.items, frozen: r.frozen })),
      },
      this.pitScene(world, poses),
    );
  }

  /** 3D view: names over the other cars (up to 300 m away) and the safety car. */
  private drawTags3d(view: View3D, world: RaceWorld, me: Racer, poses: ReadonlyMap<string, Pose>, sc: Pose | null): void {
    // A car inside a smoke cloud is hidden, name and all.
    const smoke = (this.driver.items?.()?.drops ?? []).filter((d) => d.kind === 'smoke');
    const hidden = (p: Pose) => smoke.some((d) => Math.hypot(d.x - p.x, d.y - p.y) < SMOKE_RADIUS);
    const tags = world.racers
      .filter((r) => r !== me && !hidden(poses.get(r.id)!))
      .map((r) => ({ ...poses.get(r.id)!, name: r.name, color: r.color, trackIndex: r.car.trackIndex }));
    if (sc) tags.push({ ...sc, name: 'SAFETY CAR', color: '#ffb000', trackIndex: null });
    for (const t of tags) {
      const p = view.project(t.x, t.y, 1.8, t.trackIndex);
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
    if (settings().idealLine) drawIdealLine(ctx, world.track, idealLine(world.track, undefined, me.carClass), me.car.trackIndex);
    drawPitBoxes(ctx, world);
    const pit = this.pitScene(world, poses);
    drawPitUnder(ctx, pit, poses);
    const items = this.driver.items?.() ?? null;
    if (items) {
      drawItemBoxes(ctx, items, this.driver.now());
      drawDrops(ctx, items, this.driver.meId, this.driver.now());
    }
    drawDebris(ctx, world.debris, world.racers, world.time);
    const ghosts = session?.phase === 'qualifying';
    // Time trial ghosts, under the real cars.
    for (const g of this.driver.ghostCars?.() ?? []) {
      ctx.globalAlpha = 0.45;
      drawCar(ctx, me.car.params, g.x, g.y, g.heading, 0, g.color, { drsOpen: false, compound: me.tyres.compound, rainLight: false, time: world.time, body: me.carClass });
      ctx.globalAlpha = 1;
      drawNameTag(ctx, g.label, g.x, g.y, g.color);
    }
    // Cars passing through each other turn see-through (yours too) while they overlap: everyone
    // with no contact, and cars in the pits (which never touch anyone).
    const noContact = !!session?.noContact && session.phase !== 'qualifying';
    const passing = overlapping(world.racers, poses, (a, b) => noContact || a.pit.phase !== 'out' || b.pit.phase !== 'out');
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
        body: r.carClass,
        drsOpen: r.drsOpen,
        compound: r.tyres.compound,
        lost: r.car.lost,
        parts: r.car.parts,
        rainLight: world.options.wetness >= 0.3,
        time: world.time,
      });
      ctx.globalAlpha = 1;
      if (items) drawCarEffects(ctx, r.items, p.x, p.y, this.driver.now());
      if (r !== me) drawNameTag(ctx, r.name, p.x, p.y, r.color);
    }
    drawPitOver(ctx, pit, poses);
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
    // The 3D view has its own rain.
    if (!this.view3d) drawRain(ctx, world.options.wetness, w, h, now);
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
    drawDamage(ctx, me.car, w, me.carClass);
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
        gear: me.car.gear,
        revs: me.car.revs,
        tc: me.car.tcCutting,
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
/** Party mode's ghost item in 3D: a pale see-through shimmer. */
const GHOST_ITEM_TINT = '#e4e8ff';

function overlapping(
  racers: readonly Racer[],
  poses: ReadonlyMap<string, { x: number; y: number; heading: number }>,
  /** Which pairs can pass through each other. */
  through: (a: Racer, b: Racer) => boolean,
): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < racers.length; i++) {
    for (let j = i + 1; j < racers.length; j++) {
      if (!through(racers[i], racers[j])) continue;
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
