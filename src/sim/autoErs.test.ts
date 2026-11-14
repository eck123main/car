import { describe, expect, it } from 'vitest';
import { Track } from '../track/track';
import { TRACKS } from '../tracks';
import { idealLine } from './ai/idealLine';
import { autoErs } from './autoErs';
import { IDLE_INPUT, RaceWorld } from './world';

const track = new Track(TRACKS.monza);
const ideal = idealLine(track);
const n = track.samples.length;
const FLAT = { ...IDLE_INPUT, throttle: 1 };

/** A car at sample i, along the track at this speed with this much battery. */
function carAt(i: number, speed: number, ers: number, cls: 'f1' | 'gt3' = 'f1') {
  const world = new RaceWorld(track, { drsRule: 'free', wetness: 0 });
  const r = world.addRacer('me', 'Me', 'red', 'soft', cls);
  const s = track.samples[i];
  r.car.place(s.x, s.y, Math.atan2(s.ty, s.tx), i);
  r.car.vx = s.tx * speed;
  r.car.vy = s.ty * speed;
  r.pit.phase = 'out';
  r.ers = ers;
  return r;
}

/** Samples on full throttle with at least this many more full-throttle samples ahead. */
function straightStart(ahead: number): number {
  for (let i = 0; i < n; i++) {
    let ok = true;
    for (let k = 0; k <= ahead && ok; k++) ok = ideal.cue[(i + k) % n] === 0;
    if (ok) return i;
  }
  throw new Error('no straight');
}

describe('auto ERS', () => {
  const long = straightStart(150);
  it('deploys on a long straight at speed', () => {
    expect(autoErs(track, ideal, carAt(long, 70, 0.5), FLAT)).toBe(true);
  });
  it('never where extra power adds no drive (traction-limited, low speed)', () => {
    expect(autoErs(track, ideal, carAt(long, 40, 1), FLAT)).toBe(false);
  });
  it('not off the throttle or on the brakes', () => {
    expect(autoErs(track, ideal, carAt(long, 70, 1), { ...FLAT, throttle: 0.5 })).toBe(false);
    expect(autoErs(track, ideal, carAt(long, 70, 1), { ...FLAT, brake: 1 })).toBe(false);
  });
  it('saves a low battery for later rather than spending it just before braking', () => {
    let i = 0;
    while (!(ideal.cue[(i + 3) % n] === 2 && ideal.cue[i] === 0)) i++;
    expect(autoErs(track, ideal, carAt(i, 80, 0.3), FLAT)).toBe(false);
    // A full battery would only waste the charge from the braking ahead: use it.
    expect(autoErs(track, ideal, carAt(i, 80, 1), FLAT)).toBe(true);
  });
  it('only on cars with ERS', () => {
    expect(autoErs(track, ideal, carAt(long, 70, 1, 'gt3'), FLAT)).toBe(false);
  });
  it('empty battery: nothing to deploy', () => {
    expect(autoErs(track, ideal, carAt(long, 70, 0), FLAT)).toBe(false);
  });
});
