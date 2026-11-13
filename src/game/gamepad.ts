/**
 * Game controllers (Xbox layout, the browser's "standard" mapping), in every mode.
 *
 * Driving: right trigger throttle, left trigger brake (both analog), left stick steering
 * (analog), read straight into `Keyboard.driverInput`. Every other button acts as the key it
 * stands for (a real keydown / keyup on the document), so whatever a key does anywhere in the game
 * the button does too, with no extra code per mode.
 *
 * Menus: while a menu screen is up, the D-pad or left stick moves between its buttons, A presses
 * one, B (or Menu) goes back / resumes.
 */

export interface PadDrive {
  throttle: number;
  brake: number;
  steer: number;
}

/** Button index (standard mapping) -> the key it stands for while driving. */
export const BUTTON_KEYS: Record<number, string> = {
  0: 'Space', // A: DRS
  1: 'KeyE', // B: use item (party)
  2: 'ShiftLeft', // X: ERS (hold)
  3: 'KeyC', // Y: camera
  4: 'KeyQ', // LB: look behind (hold, 3D)
  5: 'KeyR', // RB: reset to track / restart lap
  8: 'Enter', // View: ready on the grid, skip
  9: 'Escape', // Menu: menu
  10: 'KeyV', // left stick click: 3D view
  11: 'KeyP', // right stick click: pit limiter
  12: 'ArrowUp',
  13: 'ArrowDown',
  14: 'ArrowLeft',
  15: 'ArrowRight',
};

/** What `KeyboardEvent.key` says for each code we send (some screens look at `key`). */
const KEY_NAMES: Record<string, string> = {
  Space: ' ',
  KeyE: 'e',
  ShiftLeft: 'Shift',
  KeyC: 'c',
  KeyQ: 'q',
  KeyR: 'r',
  Enter: 'Enter',
  Escape: 'Escape',
  KeyV: 'v',
  KeyP: 'p',
  ArrowUp: 'ArrowUp',
  ArrowDown: 'ArrowDown',
  ArrowLeft: 'ArrowLeft',
  ArrowRight: 'ArrowRight',
};

const STICK_DEAD = 0.12;
const TRIGGER_DEAD = 0.04;

/** Stick position to steering: a dead zone, then a curve so small movements are fine corrections. */
export function stickToSteer(x: number): number {
  const a = Math.abs(x);
  if (a <= STICK_DEAD) return 0;
  const t = Math.min(1, (a - STICK_DEAD) / (1 - STICK_DEAD));
  return Math.sign(x) * Math.pow(t, 1.5);
}

export function triggerValue(v: number): number {
  return v <= TRIGGER_DEAD ? 0 : Math.min(1, (v - TRIGGER_DEAD) / (1 - TRIGGER_DEAD));
}

function pads(): Gamepad[] {
  if (typeof navigator === 'undefined' || !navigator.getGamepads) return [];
  return [...navigator.getGamepads()].filter((p): p is Gamepad => !!p && p.connected);
}

const value = (p: Gamepad, i: number) => p.buttons[i]?.value ?? 0;

/** The analog driving inputs from every connected controller (the biggest wins). */
export function padDrive(): PadDrive {
  let throttle = 0;
  let brake = 0;
  let steer = 0;
  for (const p of pads()) {
    throttle = Math.max(throttle, triggerValue(value(p, 7)));
    brake = Math.max(brake, triggerValue(value(p, 6)));
    const s = stickToSteer(p.axes[0] ?? 0);
    if (Math.abs(s) > Math.abs(steer)) steer = s;
  }
  return { throttle, brake, steer };
}

/** Elements a controller can move between in a menu. */
const FOCUSABLE = 'button:not([disabled]), select:not([disabled]), input:not([disabled]):not([type=hidden]), summary, a[href], .tyre, .track-row';

function visible(e: Element): boolean {
  const r = e.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden';
}

/** The menu screen up now, if any (game screens draw on the canvas; menus are `.screen`). */
function menuScreen(): HTMLElement | null {
  const all = document.querySelectorAll<HTMLElement>('#ui .screen');
  return all.length ? all[all.length - 1] : null;
}

/** Move focus to the nearest element in a direction (dx, dy one of -1/0/1). */
export function moveFocus(screen: HTMLElement, dx: number, dy: number): void {
  const items = [...screen.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(visible);
  if (!items.length) return;
  const current = document.activeElement instanceof HTMLElement && items.includes(document.activeElement) ? document.activeElement : null;
  if (!current) {
    focus(screen.querySelector<HTMLElement>('.primary:not([disabled])') ?? items[0]);
    return;
  }
  const c = current.getBoundingClientRect();
  const cx = c.left + c.width / 2;
  const cy = c.top + c.height / 2;
  let best: HTMLElement | null = null;
  let bestScore = Infinity;
  for (const e of items) {
    if (e === current) continue;
    const r = e.getBoundingClientRect();
    const ex = r.left + r.width / 2;
    const ey = r.top + r.height / 2;
    const along = (ex - cx) * dx + (ey - cy) * dy;
    if (along <= 4) continue;
    const across = Math.abs((ex - cx) * dy) + Math.abs((ey - cy) * dx);
    const score = along + 2 * across;
    if (score < bestScore) {
      bestScore = score;
      best = e;
    }
  }
  if (best) focus(best);
}

function focus(e: HTMLElement): void {
  if (!e.hasAttribute('tabindex') && !e.matches('button, select, input, summary, a[href]')) e.tabIndex = 0;
  e.focus();
  e.scrollIntoView({ block: 'nearest' });
}

/** B / Menu in a menu: resume or go back, whichever the screen has. */
function goBack(screen: HTMLElement): void {
  const buttons = [...screen.querySelectorAll<HTMLButtonElement>('button:not([disabled])')].filter(visible);
  const back = buttons.find((b) => /^(resume|back|cancel|close)\b/i.test(b.textContent?.trim() ?? ''));
  back?.click();
}

/** Reads the controllers every frame and turns buttons into keys (or menu moves). */
export class GamepadInput {
  private held = new Set<number>();
  /** Keys we pressed down and still have to let go. */
  private keysDown = new Set<string>();
  private stickDir = '';
  private stickRepeat = 0;
  private lastTime = 0;
  private notice: HTMLElement | null = null;
  /** The bar that stays on screen while a controller is connected. */
  private bar: HTMLElement | null = null;
  private barName = '';

  constructor(private readonly doc: Document = document) {
    window.addEventListener('gamepadconnected', (e) => this.toast(`Controller connected: ${shortName(e.gamepad.id)}`));
    window.addEventListener('gamepaddisconnected', () => this.toast('Controller disconnected'));
    const loop = (t: number) => {
      this.poll(t);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  private poll(time: number): void {
    const dt = this.lastTime ? Math.min(0.1, (time - this.lastTime) / 1000) : 0;
    this.lastTime = time;
    const list = pads();
    this.showBar(list);
    const now = new Set<number>();
    for (const p of list) p.buttons.forEach((b, i) => b.pressed && now.add(i));
    const screen = menuScreen();

    if (screen) {
      // Menus: nothing is held down as a key.
      this.releaseAll();
      const pressed = (i: number) => now.has(i) && !this.held.has(i);
      if (pressed(12)) moveFocus(screen, 0, -1);
      if (pressed(13)) moveFocus(screen, 0, 1);
      if (pressed(14)) moveFocus(screen, -1, 0);
      if (pressed(15)) moveFocus(screen, 1, 0);
      if (pressed(0)) this.press(screen);
      if (pressed(1) || pressed(9)) goBack(screen);
      this.stick(screen, list, dt);
    } else {
      for (const i of now) if (!this.held.has(i) && BUTTON_KEYS[i]) this.key('keydown', BUTTON_KEYS[i]);
      for (const i of this.held) if (!now.has(i) && BUTTON_KEYS[i]) this.key('keyup', BUTTON_KEYS[i]);
      this.stickDir = '';
    }
    this.held = now;
  }

  /** The left stick moves through a menu too, repeating while held. */
  private stick(screen: HTMLElement, list: Gamepad[], dt: number): void {
    let x = 0;
    let y = 0;
    for (const p of list) {
      if (Math.abs(p.axes[0] ?? 0) > Math.abs(x)) x = p.axes[0];
      if (Math.abs(p.axes[1] ?? 0) > Math.abs(y)) y = p.axes[1];
    }
    const dir = Math.max(Math.abs(x), Math.abs(y)) < 0.6 ? '' : Math.abs(x) > Math.abs(y) ? (x > 0 ? 'r' : 'l') : y > 0 ? 'd' : 'u';
    if (!dir) {
      this.stickDir = '';
      return;
    }
    this.stickRepeat -= dt;
    if (dir === this.stickDir && this.stickRepeat > 0) return;
    this.stickRepeat = dir === this.stickDir ? 0.12 : 0.35;
    this.stickDir = dir;
    moveFocus(screen, dir === 'r' ? 1 : dir === 'l' ? -1 : 0, dir === 'd' ? 1 : dir === 'u' ? -1 : 0);
  }

  /** A in a menu: press the focused button, or pick the main one first. */
  private press(screen: HTMLElement): void {
    const f = this.doc.activeElement;
    if (f instanceof HTMLElement && screen.contains(f) && f !== screen) {
      if (f instanceof HTMLInputElement && f.type === 'checkbox') f.click();
      else if (f instanceof HTMLSelectElement) {
        // Step to the next option (a native dropdown can't be opened from a script).
        f.selectedIndex = (f.selectedIndex + 1) % f.options.length;
        f.dispatchEvent(new Event('input', { bubbles: true }));
        f.dispatchEvent(new Event('change', { bubbles: true }));
      } else f.click();
      return;
    }
    moveFocus(screen, 0, 0);
  }

  private key(type: 'keydown' | 'keyup', code: string): void {
    if (type === 'keydown') this.keysDown.add(code);
    else if (!this.keysDown.delete(code)) return;
    this.doc.dispatchEvent(new KeyboardEvent(type, { code, key: KEY_NAMES[code] ?? code, bubbles: true }));
  }

  private releaseAll(): void {
    for (const code of [...this.keysDown]) this.key('keyup', code);
  }

  /** Bottom centre: a green dot and the controller's name, only while one is connected. */
  private showBar(list: Gamepad[]): void {
    const name = list.length ? shortName(list[0].id) + (list.length > 1 ? ` +${list.length - 1}` : '') : '';
    if (name === this.barName) return;
    this.barName = name;
    if (!name) {
      this.bar?.remove();
      this.bar = null;
      return;
    }
    if (!this.bar) {
      this.bar = this.doc.createElement('div');
      this.bar.style.cssText =
        'position:fixed;left:50%;bottom:8px;transform:translateX(-50%);z-index:999;display:flex;align-items:center;gap:7px;padding:4px 11px;border-radius:999px;background:rgba(15,17,22,.78);border:1px solid rgba(255,255,255,.12);color:#d8dae0;font:600 12px system-ui,sans-serif;pointer-events:none;white-space:nowrap';
      this.doc.body.append(this.bar);
    }
    this.bar.replaceChildren();
    const dot = this.doc.createElement('span');
    dot.style.cssText = 'width:8px;height:8px;border-radius:50%;background:#2ecc71;box-shadow:0 0 6px #2ecc71';
    this.bar.append(dot, `Controller connected · ${name}`);
  }

  private toast(text: string): void {
    this.notice?.remove();
    const n = this.doc.createElement('div');
    n.textContent = text;
    n.style.cssText =
      'position:fixed;left:50%;bottom:40px;transform:translateX(-50%);z-index:1000;padding:8px 14px;border-radius:8px;background:rgba(15,17,22,.92);color:#fff;font:600 13px system-ui,sans-serif;pointer-events:none';
    this.doc.body.append(n);
    this.notice = n;
    setTimeout(() => n.remove(), 3000);
  }
}

/** "Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e ...)" -> "Xbox Wireless Controller". */
function shortName(id: string): string {
  return id.replace(/\s*\(.*$/, '').trim() || 'gamepad';
}
