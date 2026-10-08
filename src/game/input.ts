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

  constructor(private readonly keyboard: Keyboard) {}

  read(): PlayerInput {
    if (this.keyboard.wasPressed('KeyP')) this.limiter = !this.limiter;
    for (const [code, compound] of Object.entries(TYRE_KEYS)) {
      if (this.keyboard.wasPressed(code)) this.nextTyre = compound;
    }
    return {
      ...this.keyboard.driverInput(),
      drs: this.keyboard.isDown(['Space']),
      ers: this.keyboard.isDown(['ShiftLeft', 'ShiftRight']),
      limiter: this.limiter,
      nextTyre: this.nextTyre,
      reset: this.keyboard.wasPressed('KeyR'),
    };
  }
}
