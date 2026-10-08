import { PART_NAMES, type Car, type CarParts } from '../physics/car';

const OK = '#2ecc40';
const HURT = '#ffd400';
const BAD = '#ff4136';

function color(d: number): string {
  return d < 0.15 ? OK : d < 0.45 ? HURT : BAD;
}

/** Car outline with each part coloured by damage, under the minimap (CSS pixels). */
export function drawDamage(ctx: CanvasRenderingContext2D, car: Car, width: number): void {
  const w = 200;
  const h = 118;
  const x0 = width - w - 20;
  const y0 = 230;
  ctx.fillStyle = 'rgba(10,10,14,0.7)';
  ctx.beginPath();
  ctx.roundRect(x0, y0, w, h, 8);
  ctx.fill();

  // Top-down car, nose up, drawn in a 40 x 90 box.
  const cx = x0 + 42;
  const top = y0 + 14;
  const d = car.parts;
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#555';
  ctx.fillStyle = '#26272c';
  ctx.beginPath();
  ctx.moveTo(cx, top + 6);
  ctx.lineTo(cx + 7, top + 30);
  ctx.lineTo(cx + 7, top + 82);
  ctx.lineTo(cx - 7, top + 82);
  ctx.lineTo(cx - 7, top + 30);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  const part = (p: keyof CarParts, rx: number, ry: number, rw: number, rh: number) => {
    ctx.fillStyle = color(d[p]);
    ctx.fillRect(rx, ry, rw, rh);
  };
  part('frontWing', cx - 18, top, 36, 7);
  part('rearWing', cx - 15, top + 84, 30, 7);
  part('left', cx - 17, top + 36, 9, 34);
  part('right', cx + 8, top + 36, 9, 34);

  // List with percentages.
  ctx.font = '12px system-ui, sans-serif';
  ctx.textAlign = 'left';
  let y = y0 + 26;
  for (const p of Object.keys(PART_NAMES) as (keyof CarParts)[]) {
    ctx.fillStyle = color(d[p]);
    ctx.beginPath();
    ctx.arc(x0 + 84, y - 4, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ddd';
    ctx.fillText(PART_NAMES[p], x0 + 94, y);
    ctx.fillStyle = '#999';
    ctx.textAlign = 'right';
    ctx.fillText(`${Math.round(d[p] * 100)}%`, x0 + w - 10, y);
    ctx.textAlign = 'left';
    y += 22;
  }
}
