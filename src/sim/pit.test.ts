import { describe, expect, it } from 'vitest';
import { Track } from '../track/track';
import { TRACKS } from '../tracks';
import { laneCentre, PIT_SPEED_LIMIT } from './pit';
import { IDLE_INPUT, penaltyTime, RaceWorld, type PlayerInput, type Racer, type WorldEvent } from './world';

const DT = 1 / 120;

for (const id of ['silverstone', 'test'] as const) {
  describe(`Pit stops on ${id}`, () => {
    const track = new Track(TRACKS[id]);
    const lane = track.pit!;
    const n = track.samples.length;
    const sampleAt = (s: number) => track.samples[Math.floor((((s % track.length) + track.length) % track.length) / 2) % n];

    /** Steer towards a lateral offset 15 m ahead; throttle to hold a speed. */
    function towards(r: Racer, offset: number, speed: number, extra: Partial<PlayerInput> = {}): PlayerInput {
      const q = track.query(r.car.x, r.car.y)!;
      const t = sampleAt(q.s + 15);
      const tx = t.x + t.nx * offset;
      const ty = t.y + t.ny * offset;
      let err = Math.atan2(ty - r.car.y, tx - r.car.x) - r.car.heading;
      err = Math.atan2(Math.sin(err), Math.cos(err));
      return {
        ...IDLE_INPUT,
        throttle: r.car.speed < speed ? 1 : 0,
        brake: r.car.speed > speed + 2 ? 1 : 0,
        steer: Math.max(-1, Math.min(1, err * 3)),
        ...extra,
      };
    }

    function setup(speed: number) {
      const world = new RaceWorld(track, { drsRule: 'free', wetness: 0 });
      const r = world.addRacer('a', 'A', 'red', 'medium');
      const t = sampleAt(lane.entry - 60);
      const h = Math.atan2(t.ty, t.tx);
      r.car.place(t.x, t.y, h);
      r.car.vx = Math.cos(h) * speed;
      r.car.vy = Math.sin(h) * speed;
      return { world, r };
    }

    /** Like a player: stay on track, turn into the lane at the pit entry, hold the approach speed. */
    function pitDriver(r: Racer, speed: number): PlayerInput {
      const q = track.query(r.car.x, r.car.y)!;
      const turnIn = r.pit.phase !== 'out' || track.inRange(q.s, lane.entry, lane.exit);
      return towards(r, turnIn ? laneCentre(track, q.sample.halfWidth) : 0, speed, { nextTyre: 'soft' });
    }

    function driveIntoPits(world: RaceWorld, r: Racer, speed: number, events: WorldEvent[], seconds = 40) {
      for (let t = 0; t < seconds; t += DT) {
        const input = pitDriver(r, speed);
        events.push(...world.step(DT, new Map([['a', input]])));
        if (r.pit.stops > 0 && r.pit.phase === 'out') break;
      }
    }

    it('drives the car to its box, stops for 3-4 s and fits the chosen tyres', () => {
      const { world, r } = setup(PIT_SPEED_LIMIT - 2);
      const events: WorldEvent[] = [];
      let maxSpeedAfterStop = 0;
      let stoppedFor = 0;
      let wearAfterStop = -1;
      for (let t = 0; t < 60; t += DT) {
        // Hold 70 km/h on the way in, then floor it on the way out to test the limiter.
        const input = pitDriver(r, r.pit.phase === 'leaving' ? 60 : PIT_SPEED_LIMIT - 2);
        const stepEvents = world.step(DT, new Map([['a', input]]));
        events.push(...stepEvents);
        if (stepEvents.some((e) => e.kind === 'pitStop')) wearAfterStop = r.tyres.wear;
        if (r.pit.phase === 'stopped') stoppedFor += DT;
        if (r.pit.phase === 'leaving') maxSpeedAfterStop = Math.max(maxSpeedAfterStop, r.car.speed);
        if (r.pit.stops > 0 && r.pit.phase === 'out') break;
      }
      const stop = events.find((e) => e.kind === 'pitStop');
      expect(stop).toBeDefined();
      expect(stoppedFor).toBeGreaterThanOrEqual(3);
      expect(stoppedFor).toBeLessThan(4.1);
      expect(r.tyres.compound).toBe('soft');
      expect(wearAfterStop).toBeGreaterThanOrEqual(0);
      expect(wearAfterStop).toBeLessThan(0.001);
      expect(r.compoundsUsed).toEqual(['medium', 'soft']);
      expect(maxSpeedAfterStop).toBeLessThan(PIT_SPEED_LIMIT + 0.6);
      expect(penaltyTime(r)).toBe(0);
      expect(r.timer.trackLimitWarnings).toBe(0);
      expect(r.car.damage).toBe(0);
    });

    it('gives a penalty for entering the pit lane too fast', () => {
      const { world, r } = setup(30);
      const events: WorldEvent[] = [];
      driveIntoPits(world, r, 30, events, 4);
      expect(events.some((e) => e.kind === 'pitEntry')).toBe(true);
      expect(penaltyTime(r)).toBe(5);
    });

    it('has a separate box for each of 10 cars', () => {
      expect(new Set(lane.boxes.map((s) => Math.round(s))).size).toBe(10);
    });

    it('stops cars crossing the pit wall from the track', () => {
      const world = new RaceWorld(track, { drsRule: 'free', wetness: 0 });
      const r = world.addRacer('a', 'A', 'red');
      const t = sampleAt(lane.boxes[4]);
      const h = Math.atan2(t.ty, t.tx);
      r.car.place(t.x, t.y, h);
      r.car.vx = Math.cos(h) * 20;
      r.car.vy = Math.sin(h) * 20;
      for (let k = 0; k < 120; k++) world.step(DT, new Map([['a', towards(r, laneCentre(track, t.halfWidth), 20)]]));
      const q = track.query(r.car.x, r.car.y)!;
      expect(q.d * lane.side).toBeLessThan(q.sample.halfWidth + 1.2);
      expect(r.pit.phase).toBe('out');
    });
  });
}
