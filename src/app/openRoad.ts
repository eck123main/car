import { CAR_CLASSES, type CarClassId } from '../sim/carClass';
import { Ambient } from '../audio/ambient';
import { gameAudio, gearFor, loudestSurface } from '../audio/sound';
import { skinLivery } from '../cosmetics/skins';
import { LocalControls, type Keyboard, type Mouse } from '../game/input';
import { liveryFor } from '../render/livery';
import { slipAngle } from '../render3d/feel';
import type { Cam3d, OpenRoadView } from '../render3d/openRoad/view';
import { TIME_NAMES, TIMES } from '../sim/openRoad/biomes';
import { OpenRoadDrive, RoadPilot } from '../sim/openRoad/drive';
import { IDLE_INPUT, type PlayerInput } from '../sim/world';
import { settings } from './settings';

const DT = 1 / 120;
const CAMERA_KEY = 'f1td.cam3d';
/** A crash fades out over its last part (s), and back in after the restart (s). */
const FADE_OUT = 0.5;
const FADE_IN = 0.5;
const MUSIC_KEY = 'f1td.openroad.music';
const KM_KEY = 'f1td.openroad.km';
const HELP_TIME = 14;
/** Autopilot pace limits (m/s) and step per key press. */
const PILOT_MIN = 20;
const PILOT_MAX = 90;
const PILOT_STEP = 5;

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Remembering it is a convenience only.
  }
}

/** Open road: just driving, no track, rules or timer. Its own loop, 3D only. */
export class OpenRoadScreen {
  readonly drive: OpenRoadDrive;
  private readonly controls: LocalControls;
  private readonly pilot: RoadPilot;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly ambient = new Ambient();
  private view: OpenRoadView | null = null;
  private running = false;
  private paused = false;
  private loaded = false;
  private progress = 0;
  private last = 0;
  private acc = 0;
  private dpr = 1;
  private autopilot = false;
  private showHud = true;
  private drivenAtStart = 0;
  private toast: { text: string; until: number } | null = null;
  private clock = 0;
  private savedKm = 0;
  private failed = false;
  /** Seconds left of the view coming back after a crash. */
  private fadeIn = 0;
  private cameraButton: HTMLElement | null = null;
  private prevX = 0;
  private prevY = 0;
  private prevHeading = 0;
  /** Called on Esc. */
  onMenu: () => void = () => {};

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly keyboard: Keyboard,
    mouse: Mouse | null,
    mapId: string,
    seed: number,
    private readonly skin: string | null | undefined,
    private readonly carClass: CarClassId = 'f1',
  ) {
    this.ctx = canvas.getContext('2d')!;
    this.controls = new LocalControls(keyboard, mouse);
    this.drive = new OpenRoadDrive(mapId, seed, carClass);
    this.pilot = new RoadPilot(this.drive.road, carClass);
    this.savedKm = Number(read(KM_KEY)) || 0;
    this.ambient.musicOn = read(MUSIC_KEY) === 'on';
  }

  start(): void {
    this.running = true;
    this.last = performance.now();
    window.addEventListener('resize', this.resize);
    document.addEventListener('visibilitychange', this.updateMute);
    this.resize();
    this.addCameraButton();
    gameAudio().unlock();
    this.updateMute();
    if (settings().sound) this.ambient.start(settings().volume);
    // Dev server only: reachable from the browser console, for testing.
    if (import.meta.env.DEV) (window as unknown as { f1road: OpenRoadScreen }).f1road = this;
    import('../render3d/openRoad/view')
      .then(({ OpenRoadView, CAM3D_ORDER }) => {
        if (!this.running) return;
        const view = new OpenRoadView(this.drive.land, this.carClass);
        const found = CAM3D_ORDER.find((c) => c === read(CAMERA_KEY));
        if (found) view.mode = found;
        Object.assign(view.canvas.style, { position: 'fixed', inset: '0', width: '100vw', height: '100vh' });
        this.canvas.style.position = 'relative';
        this.canvas.before(view.canvas);
        this.view = view;
        this.resize();
      })
      .catch((err: unknown) => {
        console.error(err);
        this.failed = true;
      });
    requestAnimationFrame(this.frame);
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.saveKm();
    window.removeEventListener('resize', this.resize);
    document.removeEventListener('visibilitychange', this.updateMute);
    this.updateMute();
    this.ambient.stop();
    this.cameraButton?.remove();
    this.cameraButton = null;
    this.view?.dispose();
    this.view = null;
    this.canvas.style.position = '';
    this.canvas.style.cursor = '';
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.updateMute();
  }

  /** A whole-life total, kept in this browser. */
  private saveKm(): void {
    const driven = (this.drive.distance - this.drivenAtStart) / 1000;
    this.savedKm += driven;
    this.drivenAtStart = this.drive.distance;
    write(KM_KEY, this.savedKm.toFixed(2));
  }

  private updateMute = (): void => {
    gameAudio().setMuted(!this.running || this.paused || document.hidden);
  };

  private resize = (): void => {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(window.innerWidth * this.dpr);
    this.canvas.height = Math.round(window.innerHeight * this.dpr);
    this.view?.setSize(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1);
  };

  private say(text: string, seconds = 2.5): void {
    this.toast = { text, until: this.clock + seconds };
  }

  private async nextCamera(): Promise<void> {
    if (!this.view) return;
    const { CAM3D_ORDER } = await import('../render3d/openRoad/view');
    if (!this.view) return;
    await this.setCamera(CAM3D_ORDER[(CAM3D_ORDER.indexOf(this.view.mode) + 1) % CAM3D_ORDER.length]);
  }

  private async setCamera(cam: Cam3d): Promise<void> {
    const { CAM3D_NAMES } = await import('../render3d/openRoad/view');
    if (!this.view) return;
    this.view.mode = cam;
    this.view.snap();
    write(CAMERA_KEY, cam);
    this.say(`CAMERA: ${CAM3D_NAMES[cam]}`);
  }

  /** Bottom right, as in the race view: the Camera button opens the list (C still cycles through it). */
  private addCameraButton(): void {
    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;right:16px;bottom:16px;display:flex;gap:6px;';
    const button = (onClick: () => void): HTMLButtonElement => {
      const b = document.createElement('button');
      b.tabIndex = -1;
      b.style.cssText = 'padding:6px 12px;font-size:12px;opacity:0.85;';
      // Never take focus: Space (DRS) would press it again.
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', onClick);
      return b;
    };
    const list = document.createElement('div');
    list.style.cssText = 'position:absolute;right:0;bottom:calc(100% + 6px);display:none;flex-direction:column;gap:4px;';
    const showList = async (): Promise<void> => {
      const open = list.style.display === 'none';
      list.replaceChildren();
      list.style.display = open ? 'flex' : 'none';
      if (!open) return;
      const { CAM3D_ORDER, CAM3D_NAMES } = await import('../render3d/openRoad/view');
      for (const c of CAM3D_ORDER) {
        const b = button(() => {
          void this.setCamera(c);
          list.style.display = 'none';
        });
        b.textContent = CAM3D_NAMES[c];
        b.style.textAlign = 'left';
        if (this.view?.mode === c) b.style.borderColor = '#ffd400';
        list.append(b);
      }
    };
    const cam = button(() => void showList());
    cam.textContent = 'Camera (C)';
    box.append(list, cam);
    this.canvas.after(box);
    this.cameraButton = box;
  }

  private handleKeys(): void {
    const k = this.keyboard;
    if (k.wasPressed('Escape')) this.onMenu();
    if (k.wasPressed('KeyC')) void this.nextCamera();
    if (k.wasPressed('KeyM') && this.view) {
      this.view.mirror = !this.view.mirror;
      this.say(this.view.mirror ? 'MIRROR ON' : 'MIRROR OFF');
    }
    if (k.wasPressed('KeyT') && this.view) {
      const next = TIMES[(TIMES.indexOf(this.view.timeOfDay) + 1) % TIMES.length];
      this.view.setTime(next);
      this.say(TIME_NAMES[next].toUpperCase());
    }
    if (k.wasPressed('KeyH')) this.showHud = !this.showHud;
    if (k.wasPressed('KeyN')) {
      const on = !this.ambient.musicOn;
      this.ambient.setMusic(on);
      write(MUSIC_KEY, on ? 'on' : 'off');
      this.say(on ? 'MUSIC ON' : 'MUSIC OFF');
    }
    if (k.wasPressed('KeyF')) {
      this.autopilot = !this.autopilot;
      if (this.autopilot) this.pilot.cruise = Math.max(45, Math.min(PILOT_MAX, Math.round(this.drive.car.speed / PILOT_STEP) * PILOT_STEP));
      this.say(this.autopilot ? 'AUTOPILOT: sit back · W / S change pace · steer to take over' : 'YOU HAVE THE WHEEL');
    }
    if (k.wasPressed('KeyR')) {
      this.drive.backOnRoad();
      this.view?.snap();
      this.say('BACK ON THE ROAD');
    }
    if (this.view) this.view.lookBack = !this.paused && k.isDown(['KeyQ']);
  }

  /** Autopilot unless the driver steers; W and S change its pace. */
  private applyPilot(input: PlayerInput): PlayerInput {
    if (!this.autopilot) return input;
    if (input.steer !== 0) {
      this.autopilot = false;
      this.say('YOU HAVE THE WHEEL');
      return input;
    }
    const auto = this.pilot.drive(this.drive.car);
    return { ...input, throttle: auto.throttle, brake: auto.brake, steer: auto.steer };
  }

  private frame = (now: number): void => {
    if (!this.running) return;
    const elapsed = Math.min((now - this.last) / 1000, 0.1);
    this.last = now;
    this.clock += elapsed;
    this.handleKeys();
    if (this.controls.mouse?.active) this.controls.mouseSteer = Math.max(-1, Math.min(1, (this.controls.mouse.x - window.innerWidth / 2) / (window.innerWidth * 0.3)));
    let input = this.controls.read();
    if (this.autopilot) {
      const wasW = this.keyboard.wasPressed('KeyW') || this.keyboard.wasPressed('ArrowUp');
      const wasS = this.keyboard.wasPressed('KeyS') || this.keyboard.wasPressed('ArrowDown');
      if (wasW) this.pilot.cruise = Math.min(PILOT_MAX, this.pilot.cruise + PILOT_STEP);
      if (wasS) this.pilot.cruise = Math.max(PILOT_MIN, this.pilot.cruise - PILOT_STEP);
      if (wasW || wasS) this.say(`AUTOPILOT PACE: ${Math.round(this.pilot.cruise * 3.6)} km/h`);
    }
    const car = this.drive.car;
    const view = this.view;
    if (!this.loaded) {
      if (view) {
        this.progress = view.prepare(car.x, car.y, this.drive.road.startIndex, 40);
        if (this.progress >= 1) {
          this.loaded = true;
          this.clock = 0;
        }
      }
      this.acc = 0;
      this.drawLoading();
      requestAnimationFrame(this.frame);
      return;
    }
    if (this.paused) this.acc = 0;
    else this.acc += elapsed;
    while (this.acc >= DT) {
      this.prevX = car.x;
      this.prevY = car.y;
      this.prevHeading = car.heading;
      this.drive.step(DT, this.applyPilot(this.paused ? { ...IDLE_INPUT } : input));
      input = { ...input, reset: false };
      if (this.drive.rescued) {
        // A jump, not a move: nothing to blend from.
        this.prevX = car.x;
        this.prevY = car.y;
        this.prevHeading = car.heading;
        view?.snap();
        const crashed = this.drive.rescuedBy === 'crash';
        this.say(crashed ? 'CRASHED · BACK ON THE ROAD' : 'BACK ON THE ROAD');
        if (crashed) this.fadeIn = FADE_IN;
      }
      this.acc -= DT;
    }
    if (view) this.renderFrame(view, elapsed);
    requestAnimationFrame(this.frame);
  };

  private renderFrame(view: OpenRoadView, dt: number): void {
    const { drive, ctx, canvas, dpr } = this;
    const car = drive.car;
    const a = this.acc / DT;
    const x = this.prevX + (car.x - this.prevX) * a;
    const y = this.prevY + (car.y - this.prevY) * a;
    const heading = this.prevHeading + (car.heading - this.prevHeading) * a;
    const roadIndex = drive.road.nearest(x, y, car.trackIndex);
    const slope = drive.slope();
    const speedKmh = car.speed * 3.6;
    view.render(
      {
        x,
        y,
        z: drive.land.driveHeight(x, y, roadIndex),
        uphill: slope.grade * (Math.cos(heading) * slope.tx + Math.sin(heading) * slope.ty),
        heading,
        steer: car.steer,
        speed: car.speed,
        yawRate: car.yawRate,
        brake: car.brake,
        throttle: car.throttle,
        slip: slipAngle(car.vx, car.vy, car.heading),
        drsOpen: drive.drsOpen,
        parts: car.parts,
        lost: car.lost,
        roadIndex,
        front: car.surfaceFront,
        rear: car.surfaceRear,
        livery: skinLivery(this.skin ?? undefined) ?? liveryFor(car.color),
        wheel: { speedKmh, gear: car.gear, revs: car.revs, drsOpen: drive.drsOpen, drsAvailable: car.speed > 40 && !drive.drsOpen, ers: drive.ers, ersActive: drive.ersActive, limiter: false, throttle: car.throttle, tyre: 'M', wear: 0 },
      },
      dt,
    );
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;
    this.drawFade(w, h, dt);
    if (this.showHud) this.drawHud(h, speedKmh);
    this.drawToast(w);
    const s = settings();
    gameAudio().update(
      {
        carId: 'me',
        x: car.x,
        y: car.y,
        speed: car.speed,
        throttle: car.throttle,
        brake: car.brake,
        sliding: car.sliding,
        surface: loudestSurface(car.surfaceFront, car.surfaceRear),
        drsOpen: drive.drsOpen,
        drsAvailable: false,
        ersActive: drive.ersActive,
        limiter: false,
        stopped: false,
        lights: 0,
        gear: car.gear,
        revs: car.revs,
      },
      dt,
    );
    this.ambient.update(car.speed, s.sound ? s.volume : 0, this.paused || document.hidden);
  }

  private drawLoading(): void {
    const { ctx, canvas, dpr } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;
    ctx.fillStyle = '#10141a';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#ffffff';
    ctx.font = '600 22px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(this.failed ? "Couldn't start the 3D view (WebGL off?)" : this.drive.map.name, w / 2, h / 2 - 16);
    if (this.failed) return;
    ctx.fillStyle = '#9aa3ad';
    ctx.font = '14px system-ui, sans-serif';
    ctx.fillText('Laying out the landscape…', w / 2, h / 2 + 10);
    ctx.fillStyle = '#2a2f37';
    ctx.fillRect(w / 2 - 110, h / 2 + 26, 220, 4);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(w / 2 - 110, h / 2 + 26, 220 * this.progress, 4);
  }

  private drawHud(h: number, speedKmh: number): void {
    const { ctx, drive } = this;
    ctx.textBaseline = 'alphabetic';
    // A soft shadow keeps white text readable on snow.
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = 6;
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.font = '700 44px system-ui, sans-serif';
    ctx.fillText(String(Math.round(speedKmh)), 18, h - 44);
    ctx.font = '500 13px system-ui, sans-serif';
    ctx.fillText(`km/h · gear ${drive.car.gear || gearFor(speedKmh)}${this.autopilot ? ' · AUTOPILOT' : ''}${drive.drsOpen ? ' · DRS' : ''}`, 18, h - 24);
    // ERS, under the speed.
    ctx.shadowBlur = 0;
    if (CAR_CLASSES[this.carClass].ers) {
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(18, h - 15, 120, 4);
      ctx.fillStyle = drive.ersActive ? '#ffd400' : '#7fd8ff';
      ctx.fillRect(18, h - 15, 120 * drive.ers, 4);
    }
    ctx.shadowBlur = 6;
    ctx.fillStyle = '#ffffff';
    ctx.font = '600 15px system-ui, sans-serif';
    const m = drive.land.mix(drive.car.x);
    const here = m.t < 0.5 ? m.a : m.b;
    ctx.fillText(here.name, 18, 30);
    ctx.font = '13px system-ui, sans-serif';
    const total = this.savedKm + (drive.distance - this.drivenAtStart) / 1000;
    ctx.fillText(`${(drive.distance / 1000).toFixed(1)} km this drive · ${total.toFixed(0)} km in all`, 18, 49);
    if (this.clock < HELP_TIME) {
      ctx.globalAlpha = Math.min(1, HELP_TIME - this.clock);
      ctx.fillText('No track, no timer. Just drive.', 18, 76);
      ctx.fillText('Space DRS · Shift ERS · F autopilot · C camera · T time of day', 18, 95);
      ctx.fillText('N music · H hide this · R back on the road · Esc menu', 18, 114);
      ctx.globalAlpha = 1;
    }
    ctx.shadowBlur = 0;
    ctx.textAlign = 'left';
  }

  /** A crash goes dark over its last part, and the view comes back after the restart. */
  private drawFade(w: number, h: number, dt: number): void {
    this.fadeIn = Math.max(0, this.fadeIn - dt);
    const crashing = this.drive.crashing;
    const alpha = crashing > 0 ? 1 - Math.min(1, crashing / FADE_OUT) : this.fadeIn / FADE_IN;
    if (alpha <= 0) return;
    this.ctx.fillStyle = `rgba(0,0,0,${alpha})`;
    this.ctx.fillRect(0, 0, w, h);
  }

  private drawToast(w: number): void {
    const t = this.toast;
    if (!t || t.until < this.clock) return;
    const { ctx } = this;
    ctx.font = '600 14px system-ui, sans-serif';
    ctx.textAlign = 'center';
    const width = ctx.measureText(t.text).width + 28;
    ctx.fillStyle = 'rgba(10,12,16,0.6)';
    ctx.fillRect(w / 2 - width / 2, 132, width, 30);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(t.text, w / 2, 152);
    ctx.textAlign = 'left';
  }
}
