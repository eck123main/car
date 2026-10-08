import type { SessionSnap } from '../net/protocol';
import { boxLane } from '../sim/pit';
import { pitAdvice, type PitAdvice } from '../sim/strategy';
import type { RaceWorld, Racer } from '../sim/world';

/** Each car's pit box, outlined in its colour. Drawn in world metres. */
export function drawPitBoxes(ctx: CanvasRenderingContext2D, world: RaceWorld): void {
  const lane = world.track.pit;
  if (!lane) return;
  const ss = world.track.samples;
  for (const r of world.racers) {
    const t = ss[Math.floor(lane.boxes[r.pit.box % lane.boxes.length] / 2) % ss.length];
    const off = boxLane(world.track, t.halfWidth);
    ctx.save();
    ctx.translate(t.x + t.nx * off, t.y + t.ny * off);
    ctx.rotate(Math.atan2(t.ty, t.tx));
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(-3.5, -1.8, 7, 3.6);
    ctx.lineWidth = 0.35;
    ctx.strokeStyle = r.color;
    ctx.strokeRect(-3.5, -1.8, 7, 3.6);
    ctx.restore();
  }
}

/** What the race engineer says for this car right now. */
export function adviceFor(world: RaceWorld, r: Racer, session: SessionSnap | null): PitAdvice {
  const racing = session?.phase === 'race';
  return pitAdvice({
    laps: racing ? session.laps : null,
    currentLap: r.timer.lapsCompleted + 1,
    mandatoryStop: racing && session.mandatoryStop,
    stops: r.pit.stops,
    compoundsUsed: r.compoundsUsed,
    compound: r.tyres.compound,
    nextTyre: r.input.nextTyre,
    wear: r.tyres.wear,
    damage: r.car.damage,
    wetness: world.options.wetness,
  });
}

/** Pit messages for the local driver, top centre (CSS pixels). */
export function drawPitStatus(ctx: CanvasRenderingContext2D, world: RaceWorld, r: Racer, width: number, advice: PitAdvice): void {
  const lane = world.track.pit;
  if (!lane) return;
  let text = '';
  let color = '#ffd400';
  const s = r.timer.lapDistance;
  switch (r.pit.phase) {
    case 'in':
      text = 'PIT LANE: driving to your box';
      break;
    case 'stopped':
      text = `PIT STOP  ${Math.max(0, r.pit.stopEnds - world.time).toFixed(1)}s`;
      color = '#ffffff';
      break;
    case 'leaving':
      text = 'PIT EXIT: limiter on until the end of the lane';
      break;
    case 'out':
      // Only when the engineer actually wants you in; otherwise the pit lane stays quiet.
      if (s !== null && advice.boxNow) {
        const toEntry = world.track.forwardDistance(s, lane.entry);
        if (toEntry < 400) {
          text = `BOX THIS LAP · ${advice.reason} · pit entry ${Math.round(toEntry)} m, ${lane.side > 0 ? 'right' : 'left'}, slow to 80`;
          color = '#ffd400';
        }
      }
  }
  if (!text) return;
  ctx.font = 'bold 15px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(10,10,14,0.7)';
  const w = ctx.measureText(text).width + 24;
  ctx.fillRect(width / 2 - w / 2, 52, w, 26);
  ctx.fillStyle = color;
  ctx.fillText(text, width / 2, 70);
  ctx.textAlign = 'left';
}
