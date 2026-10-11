import { describe, expect, it } from 'vitest';
import { TRACKS } from '../tracks';
import { Car } from '../physics/car';
import { F1_CAR } from '../physics/carParams';
import { Track } from './track';

describe.each(Object.entries(TRACKS))('Track %s', (_id, def) => {
  const track = new Track(def);

  it('has walls that never reach into another part of the track', () => {
    let bad = 0;
    for (const s of track.samples) {
      for (const [sign, wall] of [
        [1, s.wallR],
        [-1, s.wallL],
      ] as const) {
        const q = track.query(s.x + s.nx * sign * (wall - 0.3), s.y + s.ny * sign * (wall - 0.3));
        let ds = q ? Math.abs(q.s - s.s) : Infinity;
        ds = Math.min(ds, track.length - ds);
        if (ds > 30) bad++;
      }
    }
    expect(bad).toBe(0);
  });

  it('has a pit lane on the start/finish straight', () => {
    expect(track.pit).not.toBeNull();
    expect(track.inRange(0, track.pit!.entry, track.pit!.exit)).toBe(true);
  });

  it('has DRS zones', () => {
    expect(track.drsZones.length).toBeGreaterThan(0);
  });
});

describe('Close-together parts of a track', () => {
  // Baku's castle section runs right next to the main straight. These used to push a car
  // through the walls onto the other stretch (where it got stuck in the run-off).
  const track = new Track(TRACKS.baku);

  it.each([
    // [lap distance, angle into the wall (rad), speed (m/s), steering]
    [1560, 1.2, 50, -1],
    [1560, 1.2, 80, -1],
    [1570, 1.57, 8, 0],
    [1570, 1.57, 80, -1],
    [1570, 2, 25, -1],
    [1650, 0.15, 80, 1],
    [1660, 0.15, 80, 1],
  ])('a car hitting the wall at %i m (%f rad, %i m/s, steer %i) stays on its own stretch', (s, angle, speed, steer) => {
    const t = track.samples[Math.floor(s / 2)];
    // Pointed off the left of the track, towards the other stretch.
    const h = Math.atan2(t.ty, t.tx) - angle;
    const car = new Car(F1_CAR, 'red');
    car.place(t.x - t.nx * 3, t.y - t.ny * 3, h);
    car.vx = Math.cos(h) * speed;
    car.vy = Math.sin(h) * speed;
    for (let k = 0; k < 360; k++) {
      car.step({ throttle: 1, brake: 0, steer: -steer }, 1 / 120, track);
      const q = track.query(car.x, car.y)!;
      let ds = Math.abs(q.s - s);
      ds = Math.min(ds, track.length - ds);
      expect(ds).toBeLessThan(400);
    }
  });
});
