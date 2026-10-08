import type { DriverInput } from '../physics/car';

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
