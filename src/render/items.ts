import { ITEM_INFO, MINE_RADIUS, SMOKE_RADIUS, type ItemKind, type ItemState, type ItemView } from '../sim/items';

/** Party mode drawing: item boxes, things in flight and on the track, item effects and the item slot. */

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

/**
 * Items on the track, under the cars (world metres): oil slicks, tyre stacks and mines.
 * Mines are hidden: only the driver who dropped one sees it (faintly).
 */
export function drawDrops(ctx: CanvasRenderingContext2D, view: ItemView, meId: string, time: number): void {
  for (const d of view.drops) {
    if (d.kind === 'smoke' || (d.kind === 'mine' && d.owner !== meId)) continue;
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
    } else if (d.kind === 'barrier') {
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
    } else {
      // Your own mine: a faint blinking dot and its blast ring.
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = '#ff4136';
      ctx.lineWidth = 0.15;
      ctx.setLineDash([0.6, 0.6]);
      ctx.beginPath();
      ctx.arc(0, 0, MINE_RADIUS, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = Math.sin(time * 8) > 0 ? '#ff4136' : '#550000';
      ctx.beginPath();
      ctx.arc(0, 0, 0.6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

/** Smoke clouds, drawn over the cars so they hide whoever is inside. */
export function drawSmoke(ctx: CanvasRenderingContext2D, view: ItemView, time: number): void {
  for (const d of view.drops) {
    if (d.kind !== 'smoke') continue;
    ctx.save();
    ctx.translate(d.x, d.y);
    for (let k = 0; k < 7; k++) {
      const a = k * 0.9 + time * 0.3;
      const r = k === 0 ? 0 : SMOKE_RADIUS * 0.45;
      ctx.fillStyle = k % 2 ? 'rgba(150,150,150,0.75)' : 'rgba(185,185,185,0.75)';
      ctx.beginPath();
      ctx.arc(Math.cos(a) * r, Math.sin(a) * r, SMOKE_RADIUS * (k === 0 ? 0.6 : 0.5), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

/** Things in flight (world metres): rockets (red), homing rockets (pink) and blue shells. */
export function drawRockets(ctx: CanvasRenderingContext2D, view: ItemView, time: number): void {
  for (const m of view.rockets) {
    ctx.save();
    ctx.translate(m.x, m.y);
    ctx.rotate(m.heading);
    if (m.kind === 'blue') {
      ctx.rotate(time * 10);
      ctx.fillStyle = ITEM_INFO.blue.color;
      ctx.beginPath();
      for (let k = 0; k < 12; k++) {
        const r = k % 2 ? 1.0 : 1.6;
        const a = (k * Math.PI) / 6;
        if (k === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
        else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(0, 0, 0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      continue;
    }
    ctx.fillStyle = '#ffb000';
    const flame = 1.2 + 0.5 * Math.sin(time * 60);
    ctx.beginPath();
    ctx.moveTo(-1.1, -0.3);
    ctx.lineTo(-1.1 - flame, 0);
    ctx.lineTo(-1.1, 0.3);
    ctx.fill();
    ctx.fillStyle = ITEM_INFO[m.kind].color;
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

/** A dashed line between two cars: a hook (green) or a magnet (blue). */
export function drawTether(ctx: CanvasRenderingContext2D, from: { x: number; y: number }, to: { x: number; y: number }, color: string): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 0.5;
  ctx.setLineDash([1.5, 1]);
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  ctx.restore();
}

/** Effects around a car (world metres): a shield bubble, lightning sparks, oil spin marks. */
export function drawCarEffects(ctx: CanvasRenderingContext2D, s: ItemState, x: number, y: number, time: number): void {
  if (s.shield > 0) {
    ctx.save();
    ctx.globalAlpha = s.shield < 2 && Math.sin(time * 20) > 0 ? 0.2 : 0.5;
    ctx.strokeStyle = ITEM_INFO.shield.color;
    ctx.fillStyle = 'rgba(127, 219, 255, 0.12)';
    ctx.lineWidth = 0.35;
    ctx.beginPath();
    ctx.arc(x, y, 4.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
  if (s.zap > 0) {
    ctx.save();
    ctx.strokeStyle = ITEM_INFO.lightning.color;
    ctx.lineWidth = 0.35;
    for (let k = 0; k < 3; k++) {
      const a = time * 7 + (k * Math.PI * 2) / 3;
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(a) * 2, y + Math.sin(a) * 2);
      ctx.lineTo(x + Math.cos(a + 0.3) * 3, y + Math.sin(a + 0.3) * 3);
      ctx.lineTo(x + Math.cos(a - 0.1) * 3.6, y + Math.sin(a - 0.1) * 3.6);
      ctx.lineTo(x + Math.cos(a + 0.2) * 4.6, y + Math.sin(a + 0.2) * 4.6);
      ctx.stroke();
    }
    ctx.restore();
  }
  if (s.slip > 0) {
    ctx.save();
    ctx.strokeStyle = 'rgba(160, 140, 255, 0.8)';
    ctx.lineWidth = 0.3;
    ctx.beginPath();
    ctx.arc(x, y, 3.5, time * 9, time * 9 + Math.PI * 1.2);
    ctx.stroke();
    ctx.restore();
  }
}

/** A simple picture of each item, centred at (0, 0), about `s` px across. */
function drawIcon(ctx: CanvasRenderingContext2D, item: ItemKind, s: number, time: number): void {
  const color = item === 'star' ? rainbowColor(time, 'icon') : ITEM_INFO[item].color;
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = 0.07 * s;
  ctx.lineCap = 'round';
  ctx.beginPath();
  const rocket = (dx: number, dy: number, k: number, body: string) => {
    ctx.save();
    ctx.translate(dx * s, dy * s);
    ctx.rotate(-Math.PI / 4);
    ctx.fillStyle = body;
    ctx.fillRect(-0.3 * s * k, -0.1 * s * k, 0.45 * s * k, 0.2 * s * k);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(0.15 * s * k, -0.1 * s * k);
    ctx.lineTo(0.35 * s * k, 0);
    ctx.lineTo(0.15 * s * k, 0.1 * s * k);
    ctx.fill();
    ctx.fillStyle = '#ffb000';
    ctx.beginPath();
    ctx.moveTo(-0.3 * s * k, -0.07 * s * k);
    ctx.lineTo(-0.45 * s * k, 0);
    ctx.lineTo(-0.3 * s * k, 0.07 * s * k);
    ctx.fill();
    ctx.restore();
  };
  const star = (r1: number, r2: number, points: number) => {
    ctx.beginPath();
    for (let k = 0; k < points * 2; k++) {
      const r = (k % 2 === 0 ? r1 : r2) * s;
      const a = -Math.PI / 2 + (k * Math.PI) / points;
      if (k === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fill();
  };
  switch (item) {
    case 'boost':
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
      break;
    case 'rocket':
    case 'homing':
      rocket(0, 0, 1, color);
      if (item === 'homing') {
        // A target ring.
        ctx.lineWidth = 0.04 * s;
        ctx.beginPath();
        ctx.arc(0.22 * s, -0.22 * s, 0.12 * s, 0, Math.PI * 2);
        ctx.stroke();
      }
      break;
    case 'triple':
      rocket(-0.18, 0.14, 0.6, color);
      rocket(0, 0, 0.6, color);
      rocket(0.18, -0.14, 0.6, color);
      break;
    case 'blue':
      star(0.36, 0.22, 6);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(0, 0, 0.12 * s, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'hook':
      ctx.moveTo(0, -0.32 * s);
      ctx.lineTo(0, 0.1 * s);
      ctx.arc(-0.13 * s, 0.1 * s, 0.13 * s, 0, Math.PI);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, -0.32 * s, 0.06 * s, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'magnet':
      // A U magnet with red tips.
      ctx.lineWidth = 0.12 * s;
      ctx.lineCap = 'butt';
      ctx.arc(0, 0, 0.2 * s, Math.PI, 0, true);
      ctx.moveTo(-0.2 * s, 0);
      ctx.lineTo(-0.2 * s, -0.22 * s);
      ctx.moveTo(0.2 * s, 0);
      ctx.lineTo(0.2 * s, -0.22 * s);
      ctx.stroke();
      ctx.fillStyle = '#ff4136';
      ctx.fillRect(-0.26 * s, -0.32 * s, 0.12 * s, 0.1 * s);
      ctx.fillRect(0.14 * s, -0.32 * s, 0.12 * s, 0.1 * s);
      break;
    case 'lightning':
      ctx.moveTo(0.08 * s, -0.36 * s);
      ctx.lineTo(-0.16 * s, 0.04 * s);
      ctx.lineTo(0.0, 0.04 * s);
      ctx.lineTo(-0.08 * s, 0.36 * s);
      ctx.lineTo(0.18 * s, -0.06 * s);
      ctx.lineTo(0.02 * s, -0.06 * s);
      ctx.closePath();
      ctx.fill();
      break;
    case 'teleport':
      ctx.lineWidth = 0.05 * s;
      for (const r of [0.1, 0.2, 0.3]) {
        ctx.beginPath();
        ctx.arc(0, 0, r * s, time * 3 * (r * 10), time * 3 * (r * 10) + Math.PI * 1.4);
        ctx.stroke();
      }
      break;
    case 'star':
      star(0.38, 0.16, 5);
      break;
    case 'shield':
      ctx.moveTo(0, -0.34 * s);
      ctx.lineTo(0.28 * s, -0.22 * s);
      ctx.quadraticCurveTo(0.26 * s, 0.18 * s, 0, 0.34 * s);
      ctx.quadraticCurveTo(-0.26 * s, 0.18 * s, -0.28 * s, -0.22 * s);
      ctx.closePath();
      ctx.fill();
      break;
    case 'ghost':
      ctx.arc(0, -0.08 * s, 0.24 * s, Math.PI, 0);
      ctx.lineTo(0.24 * s, 0.3 * s);
      for (let k = 0; k < 4; k++) ctx.lineTo((0.24 - (k + 0.5) * 0.12) * s, (k % 2 ? 0.3 : 0.2) * s);
      ctx.lineTo(-0.24 * s, 0.3 * s);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#222';
      ctx.beginPath();
      ctx.arc(-0.09 * s, -0.08 * s, 0.05 * s, 0, Math.PI * 2);
      ctx.arc(0.09 * s, -0.08 * s, 0.05 * s, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'oil':
      // A drop of oil.
      ctx.moveTo(0, -0.34 * s);
      ctx.bezierCurveTo(0.12 * s, -0.12 * s, 0.26 * s, 0.02 * s, 0.26 * s, 0.12 * s);
      ctx.arc(0, 0.12 * s, 0.26 * s, 0, Math.PI);
      ctx.bezierCurveTo(-0.26 * s, 0.02 * s, -0.12 * s, -0.12 * s, 0, -0.34 * s);
      ctx.fill();
      break;
    case 'barrier':
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
      break;
    case 'mine':
      star(0.32, 0.2, 8);
      ctx.fillStyle = '#222';
      ctx.beginPath();
      ctx.arc(0, 0, 0.16 * s, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'smoke':
      for (const [dx, dy, r] of [
        [-0.14, 0.06, 0.16],
        [0.1, 0.08, 0.18],
        [0, -0.1, 0.2],
      ]) {
        ctx.beginPath();
        ctx.arc(dx * s, dy * s, r * s, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    case 'tyres':
      ctx.fillStyle = '#151515';
      ctx.arc(0, 0, 0.32 * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.lineWidth = 0.06 * s;
      ctx.arc(0, 0, 0.22 * s, 0, Math.PI * 2);
      ctx.stroke();
      break;
  }
}

/** The item slot (CSS px), top centre-left: what you hold (and how many shots) and the key to use it. */
export function drawItemSlot(ctx: CanvasRenderingContext2D, held: ItemKind | null, charges: number, width: number, time: number): void {
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
    if (charges > 1) {
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 13px sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(`×${charges}`, x + size - 4, y + 15);
    }
  }
  ctx.fillStyle = held ? '#ffffff' : '#888';
  ctx.font = 'bold 11px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(held ? 'E to use' : 'no item', x + size / 2, y + size - 5);
  if (held) {
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(ITEM_INFO[held].name, x + size + 8, y + 20);
  }
  ctx.restore();
}
