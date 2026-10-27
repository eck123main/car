import { skinLivery } from '../cosmetics/skins';
import { debrisOpacity, type Debris } from '../sim/debris';
import { COMPOUNDS } from '../sim/tyres';
import type { Racer } from '../sim/world';
import { drawFrontWing, drawRearWing } from './drawCar';
import { liveryFor } from './livery';

const CARBON = '#1b1b1b';
const TYRE = '#121212';

/**
 * Parts knocked off cars, in the paint of the car they came off: wings, wheels (rolling along,
 * or lying flat once stopped) and carbon shards. Airborne pieces are drawn a little bigger,
 * with a shadow on the road. They fade out at the end of their time on track.
 */
export function drawDebris(ctx: CanvasRenderingContext2D, debris: readonly Debris[], racers: readonly Racer[], time: number): void {
  for (const p of debris) {
    const alpha = debrisOpacity(p, time);
    if (alpha <= 0) continue;
    const owner = racers.find((r) => r.id === p.owner);
    const liv = skinLivery(owner?.skin) ?? liveryFor(owner?.color ?? '#888888');
    if (p.z > 0.05) {
      ctx.globalAlpha = alpha * 0.3;
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.ellipse(p.x + p.z * 0.4, p.y + p.z * 0.4, p.kind === 'wheel' ? 0.35 : 0.5, p.kind === 'wheel' ? 0.35 : 0.3, p.heading, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = alpha;
    ctx.save();
    ctx.translate(p.x, p.y);
    const speed = Math.hypot(p.vx, p.vy);
    // Rolling wheels face the way they roll; everything else turns with its spin.
    const rolling = p.kind === 'wheel' && speed > 3;
    ctx.rotate(rolling ? Math.atan2(p.vy, p.vx) : p.heading);
    const lift = 1 + Math.min(p.z, 4) * 0.12;
    ctx.scale(lift, lift);
    switch (p.kind) {
      case 'frontWing':
        drawFrontWing(ctx, liv, 0.25, 0.95, 1.9);
        break;
      case 'rearWing':
        drawRearWing(ctx, liv, -0.22);
        break;
      case 'wheel': {
        const sidewall = p.compound ? COMPOUNDS[p.compound].color : '#777';
        ctx.fillStyle = TYRE;
        if (rolling) {
          ctx.fillRect(-0.34, -0.19, 0.68, 0.38);
          ctx.fillStyle = sidewall;
          ctx.fillRect(-0.28, -0.19, 0.56, 0.08);
          ctx.fillRect(-0.28, 0.11, 0.56, 0.08);
        } else {
          // Lying on its side: the round tyre, the coloured sidewall and the rim.
          ctx.beginPath();
          ctx.arc(0, 0, 0.34, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = sidewall;
          ctx.lineWidth = 0.06;
          ctx.beginPath();
          ctx.arc(0, 0, 0.25, 0, Math.PI * 2);
          ctx.stroke();
          ctx.fillStyle = '#555';
          ctx.beginPath();
          ctx.arc(0, 0, 0.13, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      }
      case 'shard':
        ctx.fillStyle = p.id % 3 === 0 ? liv.body : CARBON;
        ctx.beginPath();
        ctx.moveTo(0.2, 0);
        ctx.lineTo(-0.12, 0.13);
        ctx.lineTo(-0.1, -0.12);
        ctx.closePath();
        ctx.fill();
        break;
    }
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}
