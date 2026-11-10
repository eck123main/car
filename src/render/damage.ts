import { PART_NAMES, type Car, type CarParts } from '../physics/car';
import { MINIMAP_SIZE } from './hud';
import type { CarClassId } from '../sim/carClass';

/** A GT3 has a splitter and bumper where an F1 car has its front wing. */
const GT3_NAMES: Record<keyof CarParts, string> = { ...PART_NAMES, frontWing: 'Front / splitter' };

const OK = '#2ecc40';
const HURT = '#ffd400';
const BAD = '#ff4136';
const BODY = '#2c2e34';
const WHEEL = '#121214';
const LINE = '#6b6f78';

function color(d: number): string {
  return d < 0.15 ? OK : d < 0.45 ? HURT : BAD;
}

/** A top-down car (nose up) with each damageable part coloured, under the minimap. */
export function drawDamage(ctx: CanvasRenderingContext2D, car: Car, width: number, body: CarClassId = 'f1'): void {
  const w = MINIMAP_SIZE;
  const h = 190;
  const x0 = width - w - 20;
  const y0 = 20 + MINIMAP_SIZE + 10;
  ctx.fillStyle = 'rgba(10,10,14,0.7)';
  ctx.beginPath();
  ctx.roundRect(x0, y0, w, h, 8);
  ctx.fill();

  const d = car.parts;
  ctx.save();
  // Car drawn in a 64 x 160 box, nose at the top.
  ctx.translate(x0 + 52, y0 + 15);
  ctx.lineJoin = 'round';
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = LINE;

  const shape = (pts: [number, number][], fill: string) => {
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.stroke();
  };
  const mirror = (pts: [number, number][]) => pts.map(([x, y]) => [-x, y] as [number, number]);
  const wheel = (x: number, y: number) => {
    ctx.fillStyle = WHEEL;
    ctx.beginPath();
    ctx.roundRect(x - 6, y - 11, 12, 22, 3);
    ctx.fill();
    ctx.stroke();
  };

  if (body === 'gt3') {
    drawGt3Parts(d, shape, mirror, wheel);
    ctx.restore();
    listParts(ctx, car, x0, y0, w, GT3_NAMES);
    return;
  }

  // Suspension arms.
  ctx.beginPath();
  ctx.moveTo(-26, 40);
  ctx.lineTo(26, 40);
  ctx.moveTo(-26, 128);
  ctx.lineTo(26, 128);
  ctx.stroke();
  wheel(-27, 40);
  wheel(27, 40);
  wheel(-27, 128);
  wheel(27, 128);

  // Front wing and nose.
  const fw = color(d.frontWing);
  shape([[-34, 6], [34, 6], [34, 14], [-34, 14]], fw);
  shape([[0, 2], [6, 16], [8, 52], [-8, 52], [-6, 16]], fw);
  // Main body / engine cover.
  shape([[-8, 52], [8, 52], [11, 76], [10, 128], [5, 146], [-5, 146], [-10, 128], [-11, 76]], BODY);
  // Sidepods.
  const pod: [number, number][] = [[11, 70], [22, 76], [22, 112], [12, 128], [10, 128], [11, 76]];
  shape(mirror(pod), color(d.left));
  shape(pod, color(d.right));
  // Cockpit and halo.
  ctx.fillStyle = '#0b0b0d';
  ctx.beginPath();
  ctx.ellipse(0, 74, 5.5, 11, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#9aa0a8';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, 60);
  ctx.lineTo(0, 66);
  ctx.ellipse(0, 76, 7, 10, 0, -Math.PI / 2, Math.PI * 1.5);
  ctx.stroke();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = LINE;
  // Rear wing.
  shape([[-24, 146], [24, 146], [24, 158], [-24, 158]], color(d.rearWing));
  ctx.restore();
  listParts(ctx, car, x0, y0, w, PART_NAMES);
}

type Shape = (pts: [number, number][], fill: string) => void;

/** The GT3 version: bonnet and splitter, doors and arches each side, the rear wing. */
function drawGt3Parts(d: CarParts, shape: Shape, mirror: (pts: [number, number][]) => [number, number][], wheel: (x: number, y: number) => void): void {
  wheel(-24, 40);
  wheel(24, 40);
  wheel(-24, 120);
  wheel(24, 120);
  const front = color(d.frontWing);
  shape([[-26, 6], [26, 6], [28, 14], [-28, 14]], front);
  shape([[-24, 14], [24, 14], [27, 58], [-27, 58]], front);
  const side: [number, number][] = [[14, 58], [27, 58], [24, 90], [27, 140], [14, 140], [14, 58]];
  shape(mirror(side), color(d.left));
  shape(side, color(d.right));
  // Cabin: windscreen, roof, rear window.
  shape([[-14, 58], [14, 58], [14, 140], [-14, 140]], BODY);
  shape([[-12, 62], [12, 62], [13, 76], [-13, 76]], '#0b0b0d');
  shape([[-11, 112], [11, 112], [9, 126], [-9, 126]], '#0b0b0d');
  shape([[-27, 140], [27, 140], [26, 148], [-26, 148]], BODY);
  shape([[-30, 148], [30, 148], [30, 158], [-30, 158]], color(d.rearWing));
}

/** Part list with percentages, beside the diagram. */
function listParts(ctx: CanvasRenderingContext2D, car: Car, x0: number, y0: number, w: number, names: Record<keyof CarParts, string>): void {
  const d = car.parts;
  // Part list with percentages.
  ctx.font = '13px system-ui, sans-serif';
  ctx.textAlign = 'left';
  let y = y0 + 40;
  for (const p of Object.keys(names) as (keyof CarParts)[]) {
    ctx.fillStyle = color(d[p]);
    ctx.beginPath();
    ctx.arc(x0 + 112, y - 4, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ddd';
    ctx.fillText(names[p], x0 + 122, y);
    ctx.fillStyle = '#999';
    ctx.textAlign = 'right';
    ctx.fillText(`${Math.round(d[p] * 100)}%`, x0 + w - 12, y);
    ctx.textAlign = 'left';
    y += 30;
  }
  if (car.damage > 0.15) {
    ctx.fillStyle = '#aaa';
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillText('Pit to repair', x0 + 112, y0 + 190 - 14);
  }
}
