/** The game view (top-down map or 3D first person) and 3D camera, remembered between games. */

const VIEW_KEY = 'f1td.view';
const CAM3D_KEY = 'f1td.cam3d';

export type GameView = 'top' | '3d';

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
    // Remembering the choice is a convenience only.
  }
}

export function savedView(): GameView {
  return read(VIEW_KEY) === '3d' ? '3d' : 'top';
}

export function saveView(view: GameView): void {
  write(VIEW_KEY, view);
}

export function savedCam3d(): string | null {
  return read(CAM3D_KEY);
}

export function saveCam3d(cam: string): void {
  write(CAM3D_KEY, cam);
}
