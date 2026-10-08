/** World-space rectangle (m). */
export interface ViewBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * North-up camera that follows a car, looks ahead and zooms out with speed.
 * It never rotates: a turning map is disorienting and can cause motion sickness.
 */
export class Camera {
  x = 0;
  y = 0;
  /** Pixels per metre (before devicePixelRatio). */
  zoom = 6;

  snap(x: number, y: number): void {
    this.x = x;
    this.y = y;
  }

  follow(x: number, y: number, vx: number, vy: number, dt: number): void {
    const speed = Math.hypot(vx, vy);
    const screenScale = window.innerHeight / 800;
    const targetZoom = (8 - 2.5 * Math.min(speed / 90, 1)) * screenScale;
    this.zoom += (targetZoom - this.zoom) * (1 - Math.exp(-dt * 1.5));
    const k = 1 - Math.exp(-dt * 4);
    // Look further ahead the faster we go, so corners come into view sooner.
    this.x += (x + vx * 0.6 - this.x) * k;
    this.y += (y + vy * 0.6 - this.y) * k;
  }

  /** Set ctx to draw in world metres. */
  apply(ctx: CanvasRenderingContext2D, width: number, height: number, dpr: number): void {
    const z = this.zoom * dpr;
    ctx.setTransform(z, 0, 0, z, width / 2 - this.x * z, height / 2 - this.y * z);
  }

  /** Visible world area for a canvas of the given device-pixel size. */
  bounds(width: number, height: number, dpr: number): ViewBounds {
    const hw = width / (2 * this.zoom * dpr);
    const hh = height / (2 * this.zoom * dpr);
    return { minX: this.x - hw, minY: this.y - hh, maxX: this.x + hw, maxY: this.y + hh };
  }
}
