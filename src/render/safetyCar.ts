/** Length and width of the safety car (m): a road car, a little shorter than an F1 car. */
const LENGTH = 4.8;
const WIDTH = 2.0;

/**
 * The safety car, top-down, nose along +x: a silver road car with a light bar on the roof.
 * The lights flash amber while it is leading the field and go out when it comes in.
 */
export function drawSafetyCar(ctx: CanvasRenderingContext2D, x: number, y: number, heading: number, lightsOn: boolean, time: number): void {
  const hl = LENGTH / 2;
  const hw = WIDTH / 2;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(heading);

  // Wheels peeking out.
  ctx.fillStyle = '#111';
  for (const wx of [hl - 0.95, -hl + 0.95]) {
    ctx.fillRect(wx - 0.35, -hw - 0.05, 0.7, 0.3);
    ctx.fillRect(wx - 0.35, hw - 0.25, 0.7, 0.3);
  }

  // Body.
  ctx.fillStyle = '#d6dade';
  ctx.beginPath();
  ctx.roundRect(-hl, -hw + 0.08, LENGTH, WIDTH - 0.16, 0.55);
  ctx.fill();
  // Bonnet stripes, so it reads as the safety car at a glance.
  ctx.fillStyle = '#e8402a';
  ctx.fillRect(0.9, -0.42, hl - 1.0, 0.16);
  ctx.fillRect(0.9, 0.26, hl - 1.0, 0.16);
  // Windscreen, roof and rear window.
  ctx.fillStyle = '#1d2630';
  ctx.beginPath();
  ctx.moveTo(0.9, -0.72);
  ctx.lineTo(0.9, 0.72);
  ctx.lineTo(-1.4, 0.68);
  ctx.lineTo(-1.4, -0.68);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#c2c7cc';
  ctx.fillRect(-1.0, -0.62, 1.4, 1.24);

  // Roof light bar: the two halves flash in turn.
  const flash = Math.floor(time * 3) % 2 === 0;
  const on = '#ffb000';
  const off = '#5a4a20';
  ctx.fillStyle = lightsOn && flash ? on : off;
  ctx.fillRect(-0.45, -0.6, 0.32, 0.58);
  ctx.fillStyle = lightsOn && !flash ? on : off;
  ctx.fillRect(-0.45, 0.02, 0.32, 0.58);
  if (lightsOn) {
    ctx.fillStyle = 'rgba(255, 176, 0, 0.16)';
    ctx.beginPath();
    ctx.arc(-0.3, flash ? -0.3 : 0.3, 1.3, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}
