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

/** Dropped items (world metres): oil slicks, and stacks of tyres across the road. */
export function drawDrops(ctx: CanvasRenderingContext2D, view: ItemView): void {
  for (const d of view.drops) {
    ctx.save();
    ctx.translate(d.x, d.y);
    ctx.rotate(d.heading);
    if (d.kind === 'oil') {
      ctx.fillStyle = 'rgba(20, 10, 40, 0.85)';
      ctx.beginPath();
      ctx.ellipse(0, 0, 2.4, 1.7, 0, 0, Math.PI * 2);
      ctx.ellipse(1.3, 1.1, 0.9, 0.7, 0, 0, Math.PI * 2);
      ctx.ellipse(-1.4, -1.0, 0.8, 0.6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(160, 140, 255, 0.7)';
      ctx.lineWidth = 0.18;
      ctx.beginPath();
      ctx.ellipse(-0.4, -0.3, 1.1, 0.5, -0.3, Math.PI, Math.PI * 1.8);
      ctx.stroke();
    } else {
      for (const y of [-1.3, 0, 1.3]) {
        ctx.fillStyle = '#151515';
        ctx.beginPath();
        ctx.arc(0, y, 0.68, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = y === 0 ? '#ffffff' : '#ff4136';
        ctx.lineWidth = 0.22;
        ctx.beginPath();
        ctx.arc(0, y, 0.45, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.restore();
  }
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
  } else if (item === 'oil') {
    // A drop of oil.
    ctx.moveTo(0, -0.34 * s);
    ctx.bezierCurveTo(0.12 * s, -0.12 * s, 0.26 * s, 0.02 * s, 0.26 * s, 0.12 * s);
    ctx.arc(0, 0.12 * s, 0.26 * s, 0, Math.PI);
    ctx.bezierCurveTo(-0.26 * s, 0.02 * s, -0.12 * s, -0.12 * s, 0, -0.34 * s);
    ctx.fill();
  } else if (item === 'barrier') {
    // Three tyres.
    for (const dx of [-0.24, 0, 0.24]) {
      ctx.beginPath();
      ctx.arc(dx * s, 0, 0.11 * s, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 0.035 * s;
    for (const dx of [-0.24, 0, 0.24]) {
      ctx.beginPath();
      ctx.arc(dx * s, 0, 0.06 * s, 0, Math.PI * 2);
      ctx.stroke();
    }
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
