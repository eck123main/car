import { describe, expect, it } from 'vitest';
import { boardKey, parseBoardKey } from '../sim/carClass';
import { medalTimes } from '../sim/medals';
import { TimeTrial } from '../sim/timeTrial';
import { REAL_TRACK_IDS, TRACKS } from '../tracks';
import { fullLengthDef, hasFullLength, lengthKey, parseLengthKey } from './fullLength';
import { parseTrackDef, trackToJson } from './io';
import { Track } from './track';

describe('Full length circuits', () => {
  it('every real track knows its scale, and at full length is a real circuit length', () => {
    for (const id of REAL_TRACK_IDS) {
      const def = TRACKS[id];
      expect(def.scale, id).toBeGreaterThan(0);
      const full = new Track(fullLengthDef(def));
      // Real F1 circuits are 3.3-7.1 km (Reims 7.8); Long Beach is traced on today's shorter streets (2.8 km).
      expect(full.length, id).toBeGreaterThan(2700);
      expect(full.length, id).toBeLessThan(8000);
      expect(fullLengthDef(def).width, id).toBe(def.width);
    }
  }, 60_000);

  it('scales DRS zones, the pit lane and the hills with the track', () => {
    const def = TRACKS.silverstone;
    const full = fullLengthDef(def);
    const a = new Track(def);
    const b = new Track(full);
    const k = b.length / a.length;
    expect(k).toBeCloseTo(2, 1);
    a.drsZones.forEach((z, i) => expect(b.drsZones[i].start / z.start).toBeCloseTo(k, 1));
    expect(b.drsZones.every((z) => z.end <= b.length)).toBe(true);
    expect(b.pit).not.toBeNull();
    expect(full.elevation!.step).toBeCloseTo(def.elevation!.step * 2);
    // The same real gradients.
    const grade = (t: Track) => Math.max(...t.samples.map((s) => Math.abs(s.grade)));
    expect(grade(b)).toBeCloseTo(grade(a), 1);
  });

  it('leaves real size tracks alone and keeps their board', () => {
    expect(hasFullLength(TRACKS.monaco)).toBe(false);
    expect(fullLengthDef(TRACKS.monaco)).toBe(TRACKS.monaco);
    expect(lengthKey('monaco', TRACKS.monaco, true)).toBe('monaco');
  });

  it('has its own board key per class, which reads back', () => {
    const key = boardKey(lengthKey('silverstone', TRACKS.silverstone, true), 'gt3');
    expect(key).toBe('silverstone~full@gt3');
    const { track, cls } = parseBoardKey(key);
    expect(cls).toBe('gt3');
    expect(parseLengthKey(track)).toEqual({ id: 'silverstone', full: true });
    for (const id of REAL_TRACK_IDS) expect(boardKey(lengthKey(id, TRACKS[id], true), 'gt3').length).toBeLessThanOrEqual(40);
  });

  it('medals are slower than the normal ones', () => {
    for (const cls of ['f1', 'gt3', 'lmh'] as const) {
      for (const id of REAL_TRACK_IDS) {
        const full = medalTimes(boardKey(lengthKey(id, TRACKS[id], true), cls));
        const normal = medalTimes(boardKey(id, cls));
        if (full && normal && hasFullLength(TRACKS[id])) expect(full.author, `${id} ${cls}`).toBeGreaterThan(normal.author);
      }
    }
  });

  it('a time trial can start on every full length track', () => {
    for (const id of REAL_TRACK_IDS) {
      const tt = new TimeTrial(new Track(fullLengthDef(TRACKS[id])), `${id}~full`, 'Me', 'red', 'f1');
      expect(tt.me.car.speed, id).toBeGreaterThan(0);
    }
  }, 60_000);

  it('the scale survives saving and loading a track file', () => {
    expect(parseTrackDef(JSON.parse(trackToJson(TRACKS.miami))).scale).toBe(0.6);
  });
});
