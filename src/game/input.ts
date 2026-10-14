import type { DriverInput } from '../physics/car';
import type { Compound } from '../sim/tyres';
import type { PlayerInput } from '../sim/world';

const THROTTLE = ['KeyW', 'ArrowUp'];
const BRAKE = ['KeyS', 'ArrowDown'];
const LEFT = ['KeyA', 'ArrowLeft'];
const RIGHT = ['KeyD', 'ArrowRight'];
/** Keys whose browser default (scrolling etc.) we block. */
const BLOCKED = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Tab']);

export class Keyboard {
  private readonly down = new Set<string>();
  private readonly pressed = new Set<string>();

  constructor(target: Window) {
    target.addEventListener('keydown', (e) => {
      if (BLOCKED.has(e.code)) e.preventDefault();
      if (!e.repeat) this.pressed.add(e.code);
      this.down.add(e.code);
    });
    target.addEventListener('keyup', (e) => this.down.delete(e.code));
    target.addEventListener('blur', () => this.down.clear());
  }

  isDown(codes: string[]): boolean {
    return codes.some((c) => this.down.has(c));
  }

  /** True once per key press. */
  wasPressed(code: string): boolean {
    return this.pressed.delete(code);
  }

  driverInput(): DriverInput {
    return {
      throttle: this.isDown(THROTTLE) ? 1 : 0,
      brake: this.isDown(BRAKE) ? 1 : 0,
      steer: (this.isDown(RIGHT) ? 1 : 0) - (this.isDown(LEFT) ? 1 : 0),
    };
  }
}

/**
 * Mouse driving: the car steers towards the cursor, left button is throttle, right is brake,
 * middle is DRS. It turns on with a click on the game and off when a steering key is pressed,
 * so a mouse resting somewhere never steers a keyboard player's car.
 */
export class Mouse {
  /** Cursor position (CSS px). */
  x = 0;
  y = 0;
  /** Buttons held: left, middle, right. */
  readonly buttons = [false, false, false];
  active = false;
  /** Set on the frame mouse driving turns on or off, for a message. */
  changed = false;

  constructor(canvas: HTMLElement, target: Window) {
    target.addEventListener('mousemove', (e) => {
      this.x = e.clientX;
      this.y = e.clientY;
    });
    canvas.addEventListener('mousedown', (e) => {
      if (e.button > 2) return;
      e.preventDefault();
      this.x = e.clientX;
      this.y = e.clientY;
      this.buttons[e.button] = true;
      if (!this.active) this.setActive(true);
    });
    target.addEventListener('mouseup', (e) => {
      if (e.button <= 2) this.buttons[e.button] = false;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    target.addEventListener('blur', () => this.buttons.fill(false));
  }

  setActive(active: boolean): void {
    this.active = active;
    this.changed = true;
    if (!active) this.buttons.fill(false);
  }
}

const TYRE_KEYS: Record<string, Compound> = {
  Digit1: 'soft',
  Digit2: 'medium',
  Digit3: 'hard',
  Digit4: 'inter',
  Digit5: 'wet',
};

/** Turns the keyboard into a full PlayerInput, keeping switch states (limiter, next tyres). */
export class LocalControls {
  limiter = false;
  nextTyre: Compound = 'medium';
  /** Ready on the grid (Enter, or the Ready button). */
  ready = false;

  /** Mouse driving: steering towards the cursor this frame (-1..1), set by the game screen. */
  mouseSteer = 0;

  constructor(
    private readonly keyboard: Keyboard,
    readonly mouse: Mouse | null = null,
  ) {}

  read(): PlayerInput {
    if (this.keyboard.wasPressed('KeyP')) this.limiter = !this.limiter;
    for (const [code, compound] of Object.entries(TYRE_KEYS)) {
      if (this.keyboard.wasPressed(code)) this.nextTyre = compound;
    }
    const keys = this.keyboard.driverInput();
    const mouse = this.mouse;
    // Steering with the keys hands control back to the keyboard.
    if (mouse?.active && keys.steer !== 0) mouse.setActive(false);
    const drive = mouse?.active
      ? {
          throttle: Math.max(keys.throttle, mouse.buttons[0] ? 1 : 0),
          brake: Math.max(keys.brake, mouse.buttons[2] ? 1 : 0),
          steer: this.mouseSteer,
        }
      : keys;
    return {
      ...drive,
      drs: this.keyboard.isDown(['Space']) || (mouse?.active === true && mouse.buttons[1]),
      ers: this.keyboard.isDown(['ShiftLeft', 'ShiftRight']),
      limiter: this.limiter,
      nextTyre: this.nextTyre,
      reset: this.keyboard.wasPressed('KeyR'),
      ready: this.ready || this.keyboard.isDown(['Enter', 'NumpadEnter']),
    };
  }
}
