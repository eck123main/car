import type { CarParams } from '../physics/carParams';

/** Simple top-down F1 car shape, drawn in world metres. */
export function drawCar(
  ctx: CanvasRenderingContext2D,
  p: CarParams,
  x: number,
  y: number,
  heading: number,
  steer: number,
  color: string,
): void {
  const hl = p.length / 2;
  const hw = p.width / 2;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(heading);

  // Wheels.
  ctx.fillStyle = '#151515';
  const wheel = (wx: number, wy: number, angle: number) => {
    ctx.save();
    ctx.translate(wx, wy);
    ctx.rotate(angle);
    ctx.fillRect(-0.36, -0.2, 0.72, 0.4);
    ctx.restore();
  };
  wheel(p.cgToFront, -hw + 0.2, steer);
  wheel(p.cgToFront, hw - 0.2, steer);
  wheel(-p.cgToRear, -hw + 0.22, 0);
  wheel(-p.cgToRear, hw - 0.22, 0);

  // Body: narrow nose, wider sidepods.
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(hl - 0.1, 0);
  ctx.lineTo(1.2, -0.28);
  ctx.lineTo(0.4, -0.6);
  ctx.lineTo(-1.4, -0.55);
  ctx.lineTo(-hl + 0.4, -0.3);
  ctx.lineTo(-hl + 0.4, 0.3);
  ctx.lineTo(-1.4, 0.55);
  ctx.lineTo(0.4, 0.6);
  ctx.lineTo(1.2, 0.28);
  ctx.closePath();
  ctx.fill();

  // Wings.
  ctx.fillRect(hl - 0.45, -hw + 0.05, 0.35, p.width - 0.1);
  ctx.fillStyle = '#222';
  ctx.fillRect(-hl, -0.75, 0.45, 1.5);

  // Cockpit.
  ctx.fillStyle = '#111';
  ctx.beginPath();
  ctx.ellipse(-0.1, 0, 0.45, 0.22, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}
