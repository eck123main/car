import { describe, expect, it } from 'vitest';
import { Keyboard, LocalControls, Mouse } from './input';

function event(type: string, props: Record<string, unknown>): Event {
  return Object.assign(new Event(type), { preventDefault() {} }, props);
}

function setup() {
  const win = new EventTarget() as unknown as Window;
  const canvas = new EventTarget() as unknown as HTMLElement;
  const keyboard = new Keyboard(win);
  const mouse = new Mouse(canvas, win);
  const controls = new LocalControls(keyboard, mouse);
  const key = (type: 'keydown' | 'keyup', code: string) => win.dispatchEvent(event(type, { code, repeat: false }));
  const button = (type: 'mousedown' | 'mouseup', b: number) =>
    (type === 'mousedown' ? canvas : win).dispatchEvent(event(type, { button: b, clientX: 10, clientY: 10 }));
  return { controls, mouse, key, button };
}

describe('mouse driving', () => {
  it('is off until the game is clicked, so a resting mouse never steers', () => {
    const { controls } = setup();
    controls.mouseSteer = 0.8;
    expect(controls.read().steer).toBe(0);
  });

  it('steers towards the cursor with left button throttle, right brake, middle DRS', () => {
    const { controls, button } = setup();
    button('mousedown', 0);
    controls.mouseSteer = -0.5;
    let input = controls.read();
    expect(input).toMatchObject({ throttle: 1, brake: 0, steer: -0.5, drs: false });
    button('mouseup', 0);
    button('mousedown', 2);
    button('mousedown', 1);
    input = controls.read();
    expect(input).toMatchObject({ throttle: 0, brake: 1, drs: true });
  });

  it('keeps the throttle and brake keys working alongside the mouse', () => {
    const { controls, button, key } = setup();
    button('mousedown', 0);
    button('mouseup', 0);
    key('keydown', 'KeyW');
    expect(controls.read().throttle).toBe(1);
  });

  it('hands back to the keyboard when a steering key is pressed', () => {
    const { controls, mouse, button, key } = setup();
    button('mousedown', 0);
    controls.mouseSteer = 1;
    key('keydown', 'KeyA');
    const input = controls.read();
    expect(mouse.active).toBe(false);
    expect(input).toMatchObject({ steer: -1, throttle: 0 });
  });
});
