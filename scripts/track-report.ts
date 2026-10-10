/**
 * Report on every built-in track: length, a Hard bot's lap, flat-out sections, and how
 * much the DRS zones are worth.
 *
 *   npx tsx scripts/track-report.ts [trackId]
 */
import { F1_CAR } from '../src/physics/carParams';
import { BotDriver } from '../src/sim/ai/botDriver';
import { racingLine, speedProfile } from '../src/sim/ai/racingLine';
import { RaceWorld } from '../src/sim/world';
import { Track } from '../src/track/track';
import { TRACKS } from '../src/tracks';

const DT = 1 / 120;
const PRACTICE = { phase: 'practice' as const, raceStart: 0, laps: null, mandatoryStop: false };

/** A Hard bot's flying lap, with or without DRS, and its speed at every sample. */
function testLap(track: Track, drs: boolean) {
  const n = track.samples.length;
  const world = new RaceWorld(track, { drsRule: 'free', wetness: 0 });
  const r = world.addRacer('bot', 'Bot', 'red');
  const s0 = track.samples[n - 10];
  r.car.place(s0.x, s0.y, Math.atan2(s0.ty, s0.tx));
  const bot = new BotDriver(track, 'bot', 'hard');
  const laps: number[] = [];
  const speed = new Array<number>(n).fill(0);
  const throttle = new Array<boolean>(n).fill(false);
  let drsTime = 0;
  let fullTime = 0;
  let lapTime = 0;
  for (let t = 0; t < 400 && laps.length < 2; t += DT) {
    const input = { ...bot.drive(world, PRACTICE, DT), drs };
    for (const e of world.step(DT, new Map([['bot', input]]))) if (e.kind === 'lap') laps.push(e.lap.time);
    if (laps.length === 1) {
      const s = r.timer.lapDistance;
      const full = r.car.throttle > 0.95 && r.car.brake === 0;
      if (s !== null) speed[Math.floor(s / 2) % n] = r.car.speed;
      if (s !== null) throttle[Math.floor(s / 2) % n] = full;
      if (r.drsOpen) drsTime += DT;
      if (full) fullTime += DT;
      lapTime += DT;
    }
  }
  return { lap: laps[1] ?? NaN, speed, throttle, drsTime, fullThrottle: fullTime / lapTime };
}

const only = process.argv[2];
for (const [id, def] of Object.entries(TRACKS)) {
  if (id === 'test' || (only && id !== only)) continue;
  const track = new Track(def);
  const v = speedProfile(track, racingLine(track), F1_CAR, 0.95);
  const n = v.length;

  // Flat-out sections (planned speed >= 68 m/s).
  const fast = v.map((x) => x >= 68);
  const first = fast.indexOf(false);
  const sections: { start: number; len: number }[] = [];
  let st = -1;
  for (let k = 1; k <= n; k++) {
    const i = (first + k) % n;
    if (fast[i] && st < 0) st = i;
    if (!fast[i] && st >= 0) {
      sections.push({ start: st * 2, len: ((((i - st) % n) + n) % n) * 2 });
      st = -1;
    }
  }
  // Slow corners: local minima of the plan below 45 m/s.
  let corners = 0;
  for (let i = 0; i < n; i++) {
    if (v[i] < 45 && v[i] <= v[(i - 1 + n) % n] && v[i] < v[(i + 1) % n]) corners++;
  }

  const withDrs = testLap(track, true);
  const noDrs = testLap(track, false);
  const speed = withDrs.speed;
  const kmh = (s: number) => (speed[Math.floor((((s % track.length) + track.length) % track.length) / 2) % n] * 3.6).toFixed(0);
  console.log(
    `\n${def.name} (${id}): ${track.length} m, width ${def.width} m, lap ${withDrs.lap.toFixed(1)} s, ` +
      `top ${(Math.max(...speed) * 3.6).toFixed(0)} km/h, full throttle ${(withDrs.fullThrottle * 100).toFixed(0)}%, ${corners} slow corners, ` +
      `${track.drsZones.length} DRS zones open ${withDrs.drsTime.toFixed(1)} s/lap, worth ${(noDrs.lap - withDrs.lap).toFixed(2)} s/lap`,
  );
  // Full throttle as actually driven, from corner exit to the braking point.
  const th = withDrs.throttle;
  const off = th.indexOf(false);
  let runStart = -1;
  for (let k = 1; k <= n; k++) {
    const i = (off + k) % n;
    if (th[i] && runStart < 0) runStart = i;
    if (!th[i] && runStart >= 0) {
      const len = ((((i - runStart) % n) + n) % n) * 2;
      if (len >= 150) console.log(`  full throttle ${runStart * 2}..${i * 2} m (${len} m), ${kmh(runStart * 2)} -> ${kmh(i * 2 - 2)} km/h`);
      runStart = -1;
    }
  }
  for (const z of track.drsZones) {
    console.log(
      `  DRS detect ${z.detect} start ${z.start} end ${z.end}: ${track.forwardDistance(z.start, z.end)} m long, ` +
        `detect ${track.forwardDistance(z.detect, z.start)} m before, driven ${kmh(z.start)} -> ${kmh(z.end - 10)} km/h`,
    );
  }
}
