import { describe, expect, it } from 'vitest';
import { LocalLeaderboard, mergeBest, type KeyValue } from '../net/leaderboard';
import { Track } from '../track/track';
import { REAL_TRACK_IDS, TRACKS } from '../tracks';
import { botInput } from './bot';
import { ghostDelta, ghostPose, ghostTrace } from './ghost';
import { TimeTrial, type TimeTrialLap } from './timeTrial';
import { IDLE_INPUT } from './world';

const DT = 1 / 120;
const track = new Track(TRACKS.test);

function drive(tt: TimeTrial, seconds: number): void {
  for (let t = 0; t < seconds; t += DT) tt.step(DT, botInput(track, tt.me));
}

/** Drive until the car is this far into a timed lap. */
function driveInto(tt: TimeTrial, s: number): void {
  for (let i = 0; i < 120 * 120; i++) {
    tt.step(DT, botInput(track, tt.me));
    const d = tt.me.timer.lapDistance;
    if (tt.lapTime() !== null && d !== null && d > s && d < s + 50) return;
  }
  throw new Error('never got there');
}

/** Move the car sideways from the centreline by `d` metres, keeping its speed. */
function shift(tt: TimeTrial, d: number): void {
  const c = tt.me.car;
  const q = track.query(c.x, c.y, c.trackIndex)!;
  const s = q.sample;
  c.x = c.prevX = s.x + s.nx * d;
  c.y = c.prevY = s.y + s.ny * d;
  c.heading = c.prevHeading = Math.atan2(s.ty, s.tx);
}

describe('Time trial', () => {
  it('restarts rolling just before the line, so the timed lap starts at once', () => {
    const tt = new TimeTrial(track, 'test', 'Me', '#e10600');
    expect(tt.me.car.speed).toBeGreaterThan(10);
    expect(tt.lapTime()).toBeNull();
    drive(tt, 5);
    expect(tt.lapTime()).not.toBeNull();
  });

  it.each(REAL_TRACK_IDS)('%s: a restart reaches the line hands-off, on track', (id) => {
    const t = new Track(TRACKS[id]);
    const tt = new TimeTrial(t, id, 'Me', '#e10600');
    for (let i = 0; i < 120 * 4 && tt.lapTime() === null; i++) tt.step(DT, IDLE_INPUT);
    expect(tt.lapTime()).not.toBeNull();
    expect(tt.invalidAt).toBeNull();
    expect(tt.me.car.damage).toBe(0);
  });

  it('a clean lap counts and comes with a ghost of it', () => {
    const tt = new TimeTrial(track, 'test', 'Me', '#e10600');
    const laps: TimeTrialLap[] = [];
    tt.onLap = (l) => laps.push(l);
    drive(tt, 200);
    expect(laps.length).toBeGreaterThanOrEqual(2);
    const lap = laps[0];
    expect(lap.ghost.time).toBe(lap.time);
    // The ghost replays the lap: at the start it's at the line, and it stops after the finish.
    const start = ghostPose(lap.ghost, 0)!;
    const q = track.query(start.x, start.y)!;
    expect(Math.min(q.s, track.length - q.s)).toBeLessThan(5);
    expect(ghostPose(lap.ghost, lap.time + 1)).toBeNull();
    // Racing your own ghost on the same line: dead level the whole way.
    const trace = ghostTrace(lap.ghost, track);
    expect(ghostDelta(trace, trace[20], 205)).toBeCloseTo(0, 1);
  });

  it('cancels the lap with all four wheels off, but not with two', () => {
    const tt = new TimeTrial(track, 'test', 'Me', '#e10600');
    const laps: TimeTrialLap[] = [];
    tt.onLap = (l) => laps.push(l);
    driveInto(tt, 100);
    // Two wheels over the edge (the car's centre on the white line): still counts.
    const half = tt.me.car.params.width / 2;
    const edge = track.query(tt.me.car.x, tt.me.car.y)!.sample.halfWidth;
    shift(tt, edge + 1);
    tt.step(DT, IDLE_INPUT);
    expect(tt.me.timer.offTrack).toBe(false);
    expect(tt.invalidAt).toBeNull();
    // Well clear of the edge and any kerb: the lap is gone.
    shift(tt, edge + half + 6);
    tt.step(DT, IDLE_INPUT);
    expect(tt.invalidAt).not.toBeNull();
    expect(tt.invalidReason).toBe('all four wheels off track');
    expect(tt.me.timer.valid).toBe(false);
    // Keep driving: that lap isn't reported, the next one is clean again.
    shift(tt, 0);
    drive(tt, 160);
    expect(laps.length).toBeGreaterThanOrEqual(1);
    expect(tt.invalidAt).toBeNull();
  });

  it('restarting from the line throws the lap away and starts over', () => {
    const tt = new TimeTrial(track, 'test', 'Me', '#e10600');
    driveInto(tt, 100);
    shift(tt, 40);
    tt.step(DT, IDLE_INPUT);
    expect(tt.invalidAt).not.toBeNull();
    tt.restart();
    expect(tt.invalidAt).toBeNull();
    expect(tt.lapTime()).toBeNull();
    drive(tt, 5);
    expect(tt.lapTime()).not.toBeNull();
    expect(tt.me.timer.valid).toBe(true);
  });
});

describe('Local leaderboard', () => {
  const memory = (): KeyValue => {
    const m = new Map<string, string>();
    return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
  };

  it("keeps each player's best, fastest first", async () => {
    const b = new LocalLeaderboard(memory());
    await b.submit('t', { player: 'a', name: 'A', time: 50, sectors: [] }, null);
    await b.submit('t', { player: 'b', name: 'B', time: 48, sectors: [] }, null);
    await b.submit('t', { player: 'a', name: 'A', time: 47, sectors: [] }, null);
    await b.submit('t', { player: 'b', name: 'B', time: 49, sectors: [] }, null);
    expect((await b.top('t')).map((e) => [e.player, e.time])).toEqual([
      ['a', 47],
      ['b', 48],
    ]);
    expect(await b.top('other')).toEqual([]);
  });

  it('keeps the ghost of the record lap only', async () => {
    const b = new LocalLeaderboard(memory());
    const ghost = (time: number) => ({ track: 't', name: 'x', time, dt: 0.05, x: [0], y: [0], h: [0] });
    await b.submit('t', { player: 'a', name: 'A', time: 50, sectors: [] }, ghost(50));
    await b.submit('t', { player: 'b', name: 'B', time: 52, sectors: [] }, ghost(52));
    expect((await b.recordGhost('t'))?.time).toBe(50);
    await b.submit('t', { player: 'b', name: 'B', time: 49, sectors: [] }, ghost(49));
    expect((await b.recordGhost('t'))?.time).toBe(49);
  });

  it('mergeBest ignores a slower lap', () => {
    const list = [{ player: 'a', name: 'A', time: 40, sectors: [] }];
    expect(mergeBest(list, { player: 'a', name: 'A', time: 41, sectors: [] })).toBe(list);
  });
});
