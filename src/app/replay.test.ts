import { describe, expect, it } from 'vitest';
import { ReplayRecorder, type ReplayCar } from './replay';

const car = (x: number, more: Partial<ReplayCar> = {}): ReplayCar => ({
  x,
  y: 0,
  heading: 0,
  steer: 0,
  speed: 10,
  brake: 0,
  throttle: 1,
  slip: 0,
  yawRate: 0,
  drs: false,
  ers: 1,
  ersOn: false,
  lost: 0,
  ...more,
});

describe('Replay recorder', () => {
  it('plays back between the ticks it recorded', () => {
    const r = new ReplayRecorder(20, 10);
    for (let i = 0; i <= 20; i++) r.record(i / 20, [['a', car(i)]]);
    expect(r.sample('a', 0.5)!.x).toBeCloseTo(10);
    expect(r.sample('a', 0.525)!.x).toBeCloseTo(10.5);
  });

  it('knows nothing about cars it never saw', () => {
    const r = new ReplayRecorder(20, 10);
    r.record(0, [['a', car(0)]]);
    expect(r.sample('b', 0)).toBeNull();
  });

  it('a long race keeps only the last stretch', () => {
    const r = new ReplayRecorder(20, 10);
    for (let i = 0; i <= 600; i++) r.record(i / 20, [['a', car(i)]]);
    const [from, to] = r.range;
    expect(to).toBeCloseTo(30);
    expect(from).toBeGreaterThan(19.9);
    expect(r.sample('a', 25)!.x).toBeCloseTo(500);
    // Asking for older than that gives the oldest it has.
    expect(r.sample('a', 1)!.x).toBeCloseTo(from * 20);
  });

  it('does not sweep a car across the map when it was reset', () => {
    const r = new ReplayRecorder(20, 10);
    r.record(0, [['a', car(0)]]);
    r.record(0.05, [['a', car(500)]]);
    expect(r.sample('a', 0.025)!.x).toBe(0);
  });

  it('turns the short way round', () => {
    const r = new ReplayRecorder(20, 10);
    r.record(0, [['a', car(0, { heading: 3.1 })]]);
    r.record(0.05, [['a', car(1, { heading: -3.1 })]]);
    const h = r.sample('a', 0.025)!.heading;
    expect(Math.abs(Math.abs(h) - Math.PI)).toBeLessThan(0.1);
  });

  it('finds the start of the last lap, not the finish line itself', () => {
    const r = new ReplayRecorder(20, 100);
    for (let i = 0; i <= 1200; i++) r.record(i / 20, [['a', car(i)]]);
    r.noteLaps(0, 'a', 0);
    r.noteLaps(20, 'a', 1);
    r.noteLaps(40, 'a', 2);
    r.noteLaps(60, 'a', 3);
    expect(r.lastLapStart('a', true)).toBe(40);
    expect(r.lastLapStart('a', false)).toBe(60);
    expect(r.lastLapStart('nobody', true)).toBe(0);
  });
});
