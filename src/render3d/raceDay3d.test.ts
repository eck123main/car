import { describe, expect, it } from 'vitest';
import { crewOffset } from './raceDay3d';
import { marbleCount, sunsetShare } from './trackLife3d';
import { tourShot, TvDirector, zoomFor } from './tvCamera';
import { Track } from '../track/track';
import { TRACKS } from '../tracks';

const track = new Track(TRACKS.silverstone);
const flat = () => 0;

describe('Grid crew', () => {
  it('stand beside the car and walk away from it', () => {
    expect(crewOffset(1, 0)).toBeGreaterThan(1.5);
    expect(crewOffset(-1, 0)).toBeLessThan(-1.5);
    expect(crewOffset(1, 3)).toBeGreaterThan(crewOffset(1, 1));
  });
});

describe('Light through a race', () => {
  it('a day race sinks towards sunset, a night race stays as it is', () => {
    expect(sunsetShare('day', 0)).toBe(0);
    expect(sunsetShare('day', 1)).toBe(1);
    expect(sunsetShare('day', 2)).toBe(1);
    expect(sunsetShare('night', 1)).toBe(0);
    expect(sunsetShare('dusk', 1)).toBeLessThan(1);
  });
});

describe('Marbles', () => {
  it('grow with the race, within the limit', () => {
    expect(marbleCount(0, 900)).toBe(0);
    expect(marbleCount(0.5, 900)).toBe(450);
    expect(marbleCount(5, 900)).toBe(900);
  });
});

describe('TV director', () => {
  it('uses a longer lens the further off it is', () => {
    expect(zoomFor(200)).toBeLessThan(zoomFor(30));
    expect(zoomFor(1000)).toBe(9);
  });

  it('cuts between shots as the car drives round', () => {
    const tv = new TvDirector(track, flat);
    const eyes = new Set<string>();
    const n = track.samples.length;
    for (let i = 0; i < 1500; i++) {
      const s = track.samples[Math.floor(i / 2) % n];
      const shot = tv.step(s.x, s.y, Math.atan2(s.ty, s.tx), null, 1 / 30);
      expect(shot.fov).toBeGreaterThan(5);
      expect(Number.isFinite(shot.eye[0] + shot.eye[1] + shot.eye[2])).toBe(true);
      eyes.add(`${shot.fov === 24}|${shot.fov === 58}`);
    }
    // Trackside, helicopter and tracking all came up.
    expect(eyes.size).toBe(3);
  });

  it('a trackside camera is off the road', () => {
    const tv = new TvDirector(track, flat);
    const s = track.samples[100];
    const { eye } = tv.step(s.x, s.y, Math.atan2(s.ty, s.tx), null, 1 / 30);
    const hit = track.query(eye[0], eye[2])!;
    expect(Math.abs(hit.d)).toBeGreaterThan(hit.sample.halfWidth);
  });
});

describe('Fly-around', () => {
  it('stays above the track and goes all the way round', () => {
    const a = tourShot(track, 0, flat);
    const b = tourShot(track, 5, flat);
    expect(a.eye[1]).toBeGreaterThan(20);
    expect(Math.hypot(a.eye[0] - b.eye[0], a.eye[2] - b.eye[2])).toBeGreaterThan(50);
    const again = tourShot(track, 16, flat);
    expect(again.eye[0]).toBeCloseTo(a.eye[0]);
  });
});
