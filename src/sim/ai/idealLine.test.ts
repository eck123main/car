import { describe, expect, it } from 'vitest';
import { Track } from '../../track/track';
import { TRACKS } from '../../tracks';
import IDEAL from '../../tracks/ideal-lines.json';
import { TimeTrial } from '../timeTrial';
import { boxQP, COARSE, idealLine, LineDriver, type IdealRecord } from './idealLine';
import { racingLine } from './racingLine';

const RECORDS = IDEAL as Record<string, IdealRecord>;
const DT = 1 / 120;

describe('ideal line', () => {
  it('solves a bounded least-squares problem', () => {
    // min (x0 - 3)^2 + (x1 + 1)^2 + (x0 - x1)^2 with -1 <= x <= 1
    const H = new Float64Array([4, -2, -2, 4]);
    const g = new Float64Array([-6, 2]);
    const x = boxQP(H, g, [-1, -1], [1, 1], 2);
    expect(x[0]).toBeCloseTo(1, 6);
    // With x0 held at 1: 4 x1 - 2 + 2 = 0
    expect(x[1]).toBeCloseTo(0, 6);
  });

  it('has a stored line for most real tracks, inside the track', () => {
    expect(Object.keys(RECORDS).length).toBeGreaterThan(30);
    for (const [id, rec] of Object.entries(RECORDS)) {
      const track = new Track(TRACKS[id]);
      expect(rec.offsets.length, id).toBe(Math.floor(track.samples.length / COARSE));
      const ideal = idealLine(track, id);
      expect(ideal.time, id).toBe(rec.time);
      ideal.line.offset.forEach((o, i) => expect(Math.abs(o), id).toBeLessThanOrEqual(track.samples[i].halfWidth));
    }
  });

  it('bends less than the bots line, so corners are faster', () => {
    const track = new Track(TRACKS.silverstone);
    const energy = (k: number[]) => k.reduce((a, b) => a + b * b, 0);
    expect(energy(idealLine(track, 'silverstone').line.curvature)).toBeLessThan(0.6 * energy(racingLine(track).curvature));
  });

  it('marks braking zones red where the speed falls into a corner', () => {
    const track = new Track(TRACKS.silverstone);
    const { cue, speed } = idealLine(track, 'silverstone');
    const n = cue.length;
    let zones = 0;
    for (let i = 0; i < n; i++) {
      if (cue[i] !== 2 || cue[(i + n - 1) % n] === 2) continue;
      zones++;
      let end = i;
      while (cue[end % n] === 2) end++;
      // Brake from the start of the red to its end: a real slowdown.
      expect(speed[end % n]).toBeLessThan(speed[i] + 1);
      expect(end - i).toBeGreaterThan(3);
    }
    // Silverstone: a handful of real braking zones, not a flicker of tiny ones.
    expect(zones).toBeGreaterThanOrEqual(4);
    expect(zones).toBeLessThan(20);
    expect(cue.includes(0) && cue.includes(1)).toBe(true);
  });

  it.each(['silverstone', 'monaco', 'jeddah'].filter((id) => RECORDS[id]))('drives a clean lap at %s in the stored time', (id) => {
    const track = new Track(TRACKS[id]);
    const tt = new TimeTrial(track, id, 'Ideal', 'red');
    const driver = new LineDriver(track, idealLine(track, id), 'me');
    let lap: number | null = null;
    tt.onLap = (l) => (lap = l.time);
    for (let t = 0; t < 240 && lap === null; t += DT) {
      tt.step(DT, driver.drive(tt.world));
      if (tt.me.timer.lapStart !== null) expect(tt.invalidAt).toBeNull();
    }
    expect(lap).toBeCloseTo(RECORDS[id].time, 2);
  });
});
