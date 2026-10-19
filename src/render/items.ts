import { ITEM_INFO, type ItemKind, type ItemView } from '../sim/items';

/** Party mode drawing: item boxes, rockets, hook lines, rainbow cars and the item slot. */

/** A rainbow car's paint right now (cycles through the colours). */
export function rainbowColor(time: number, id: string): string {
  const offset = [...id].reduce((h, c) => h + c.charCodeAt(0), 0) * 37;
  return `hsl(${Math.round((time * 540 + offset) % 360)}, 95%, 55%)`;
}

/** Boxes (world metres): small spinning cubes in shifting colours with a "?". */
export function drawItemBoxes(ctx: CanvasRenderingContext2D, view: ItemView, time: number): void {
  const size = 2.2;
  view.boxes.forEach((b, i) => {
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(time * 1.5 + i);
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = `hsl(${Math.round((time * 120 + i * 50) % 360)}, 90%, 60%)`;
    ctx.fillRect(-size / 2, -size / 2, size, size);
    ctx.globalAlpha = 1;
    ctx.lineWidth = 0.25;
    ctx.strokeStyle = '#ffffff';
    ctx.strokeRect(-size / 2, -size / 2, size, size);
    ctx.rotate(-(time * 1.5 + i));
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 1.7px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('?', 0, 0.1);
    ctx.restore();
  });
}

/** Rockets (world metres): a red body with a white nose and a flickering flame. */
export function drawRockets(ctx: CanvasRenderingContext2D, view: ItemView, time: number): void {
  for (const m of view.rockets) {
    ctx.save();
    ctx.translate(m.x, m.y);
    ctx.rotate(m.heading);
    ctx.fillStyle = '#ffb000';
    const flame = 1.2 + 0.5 * Math.sin(time * 60);
    ctx.beginPath();
    ctx.moveTo(-1.1, -0.3);
    ctx.lineTo(-1.1 - flame, 0);
    ctx.lineTo(-1.1, 0.3);
    ctx.fill();
    ctx.fillStyle = '#ff4136';
    ctx.fillRect(-1.1, -0.35, 1.7, 0.7);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(0.6, -0.35);
    ctx.lineTo(1.2, 0);
    ctx.lineTo(0.6, 0.35);
    ctx.fill();
    ctx.restore();
  }
}

/** The hook's line from the car that threw it to the car it caught. */
export function drawHookLine(ctx: CanvasRenderingContext2D, from: { x: number; y: number }, to: { x: number; y: number }): void {
  ctx.save();
  ctx.strokeStyle = ITEM_INFO.hook.color;
  ctx.lineWidth = 0.5;
  ctx.setLineDash([1.5, 1]);
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  ctx.restore();
}

/** A simple picture of each item, centred at (0, 0), about `s` px across. */
function drawIcon(ctx: CanvasRenderingContext2D, item: ItemKind, s: number, time: number): void {
  ctx.fillStyle = ITEM_INFO[item].color;
  ctx.beginPath();
  if (item === 'boost') {
    // Chevrons: >>
    for (const dx of [-0.22, 0.12]) {
      ctx.moveTo((dx - 0.15) * s, -0.3 * s);
      ctx.lineTo((dx + 0.15) * s, 0);
      ctx.lineTo((dx - 0.15) * s, 0.3 * s);
      ctx.lineTo((dx - 0.05) * s, 0.3 * s);
      ctx.lineTo((dx + 0.25) * s, 0);
      ctx.lineTo((dx - 0.05) * s, -0.3 * s);
      ctx.closePath();
    }
    ctx.fill();
  } else if (item === 'rocket') {
    ctx.save();
    ctx.rotate(-Math.PI / 4);
    ctx.fillRect(-0.3 * s, -0.1 * s, 0.45 * s, 0.2 * s);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(0.15 * s, -0.1 * s);
    ctx.lineTo(0.35 * s, 0);
    ctx.lineTo(0.15 * s, 0.1 * s);
    ctx.fill();
    ctx.fillStyle = '#ffb000';
    ctx.beginPath();
    ctx.moveTo(-0.3 * s, -0.07 * s);
    ctx.lineTo(-0.45 * s, 0);
    ctx.lineTo(-0.3 * s, 0.07 * s);
    ctx.fill();
    ctx.restore();
  } else if (item === 'hook') {
    ctx.strokeStyle = ITEM_INFO.hook.color;
    ctx.lineWidth = 0.08 * s;
    ctx.beginPath();
    ctx.moveTo(0, -0.32 * s);
    ctx.lineTo(0, 0.1 * s);
    ctx.arc(-0.13 * s, 0.1 * s, 0.13 * s, 0, Math.PI);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, -0.32 * s, 0.06 * s, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // Rainbow: a star in shifting colours.
    ctx.fillStyle = rainbowColor(time, 'icon');
    for (let k = 0; k < 10; k++) {
      const r = (k % 2 === 0 ? 0.38 : 0.16) * s;
      const a = -Math.PI / 2 + (k * Math.PI) / 5;
      if (k === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fill();
  }
}

/** The item slot (CSS px), top centre-left: what you hold and the key to use it. */
export function drawItemSlot(ctx: CanvasRenderingContext2D, held: ItemKind | null, width: number, time: number): void {
  const size = 64;
  const x = Math.max(12, width / 2 - 250);
  const y = 12;
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(x, y, size, size);
  ctx.lineWidth = 2;
  ctx.strokeStyle = held ? ITEM_INFO[held].color : '#666';
  ctx.strokeRect(x, y, size, size);
  if (held) {
    ctx.save();
    ctx.translate(x + size / 2, y + size / 2 - 4);
    drawIcon(ctx, held, size, time);
    ctx.restore();
  }
  ctx.fillStyle = held ? '#ffffff' : '#888';
  ctx.font = 'bold 11px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(held ? `${ITEM_INFO[held].name} · E` : 'no item', x + size / 2, y + size - 5);
  ctx.restore();
}
