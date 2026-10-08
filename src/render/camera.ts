/**
 * Follows a car, looks ahead and zooms out with speed.
 * "north" keeps the map fixed; "chase" rotates so the car always points up.
 */
export type CameraMode = 'north' | 'chase';

export class Camera {
  x = 0;
  y = 0;
  /** Pixels per metre (before devicePixelRatio). */
  zoom = 6;
  /** Screen rotation (rad) in chase mode. */
  angle = 0;
  mode: CameraMode = 'chase';

  snap(x: number, y: number, heading: number): void {
    this.x = x;
    this.y = y;
    this.angle = heading;
  }

  follow(x: number, y: number, vx: number, vy: number, heading: number, dt: number): void {
    const speed = Math.hypot(vx, vy);
    const screenScale = window.innerHeight / 800;
    const targetZoom = (5.5 - 2.5 * Math.min(speed / 90, 1)) * screenScale;
    this.zoom += (targetZoom - this.zoom) * (1 - Math.exp(-dt * 1.5));
    const k = 1 - Math.exp(-dt * 4);
    this.x += (x + vx * 0.4 - this.x) * k;
    this.y += (y + vy * 0.4 - this.y) * k;
    let diff = heading - this.angle;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    this.angle += diff * (1 - Math.exp(-dt * 5));
  }

  /** Set ctx to draw in world metres. */
  apply(ctx: CanvasRenderingContext2D, width: number, height: number, dpr: number): void {
    const z = this.zoom * dpr;
    ctx.setTransform(1, 0, 0, 1, width / 2, height / 2);
    ctx.scale(z, z);
    if (this.mode === 'chase') ctx.rotate(-this.angle - Math.PI / 2);
    ctx.translate(-this.x, -this.y);
  }
}
