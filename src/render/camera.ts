/** World-space rectangle (m). */
export interface ViewBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * - 'fixed' (default): north-up map; the car moves around it.
 * - 'rotate': the map turns so the car always drives up the screen. Optional (C key):
 *   some players find a turning map disorienting.
 */
export type CameraMode = 'fixed' | 'rotate';

/** Follows a car, looks ahead and zooms out with speed. */
export class Camera {
  x = 0;
  y = 0;
  /** Pixels per metre (before devicePixelRatio). */
  zoom = 6;
  mode: CameraMode = 'fixed';
  /** Screen rotation in 'rotate' mode: the car's heading, smoothed. */
  private angle = 0;

  snap(x: number, y: number, heading = this.angle): void {
    this.x = x;
    this.y = y;
    this.angle = heading;
  }

  follow(x: number, y: number, vx: number, vy: number, heading: number, dt: number): void {
    const speed = Math.hypot(vx, vy);
    const screenScale = window.innerHeight / 800;
    const targetZoom = (8 - 2.5 * Math.min(speed / 90, 1)) * screenScale;
    this.zoom += (targetZoom - this.zoom) * (1 - Math.exp(-dt * 1.5));
    const k = 1 - Math.exp(-dt * 4);
    // Look further ahead the faster we go, so corners come into view sooner.
    this.x += (x + vx * 0.6 - this.x) * k;
    this.y += (y + vy * 0.6 - this.y) * k;
    // Turn smoothly (not instantly) so the map doesn't snap around in a slide or spin.
    let diff = heading - this.angle;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    this.angle += diff * (1 - Math.exp(-dt * 4));
  }

  /** Set ctx to draw in world metres. */
  apply(ctx: CanvasRenderingContext2D, width: number, height: number, dpr: number): void {
    const z = this.zoom * dpr;
    if (this.mode === 'fixed') {
      ctx.setTransform(z, 0, 0, z, width / 2 - this.x * z, height / 2 - this.y * z);
      return;
    }
    // Car heading points up the screen.
    ctx.setTransform(1, 0, 0, 1, width / 2, height / 2);
    ctx.scale(z, z);
    ctx.rotate(-this.angle - Math.PI / 2);
    ctx.translate(-this.x, -this.y);
  }

  /** Visible world area for a canvas of the given device-pixel size. */
  bounds(width: number, height: number, dpr: number): ViewBounds {
    let hw = width / (2 * this.zoom * dpr);
    let hh = height / (2 * this.zoom * dpr);
    // Rotated, any part of the screen's diagonal can point any way.
    if (this.mode === 'rotate') hw = hh = Math.hypot(hw, hh);
    return { minX: this.x - hw, minY: this.y - hh, maxX: this.x + hw, maxY: this.y + hh };
  }
}
