/** Simple rain: a grey tint plus falling streaks, stronger the wetter it is. CSS pixels. */
export function drawRain(ctx: CanvasRenderingContext2D, wetness: number, width: number, height: number, time: number): void {
  if (wetness <= 0.02) return;
  ctx.fillStyle = `rgba(40, 55, 75, ${0.22 * wetness})`;
  ctx.fillRect(0, 0, width, height);
  const drops = Math.round(160 * wetness);
  ctx.strokeStyle = 'rgba(190, 210, 235, 0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < drops; i++) {
    // Each drop has a fixed lane and speed; position wraps over time.
    const seed = Math.sin(i * 127.1) * 43758.5453;
    const fx = seed - Math.floor(seed);
    const speed = 600 + 400 * fract(seed * 7.3);
    const x = (fx * (width + 200) + time * 120) % (width + 200) - 100;
    const y = (fract(seed * 3.1) * height + time * speed) % (height + 40) - 20;
    ctx.moveTo(x, y);
    ctx.lineTo(x - 4, y + 14);
  }
  ctx.stroke();
}

function fract(x: number): number {
  return x - Math.floor(x);
}
