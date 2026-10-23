import { describe, expect, it } from 'vitest';
import { adjustStoredTimes } from './adjustTimes';

function store(data: Record<string, unknown>) {
  const m = new Map(Object.entries(data).map(([k, v]) => [k, JSON.stringify(v)]));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
}

describe('adjusting stored times after a physics change', () => {
  const factors = { baku: 1.01, monza: 1 };

  it('rescales laps, sectors and ghosts on changed tracks only, once', () => {
    const kv = store({
      'f1td.tt.baku': [{ player: 'p', name: 'P', time: 60, sectors: [20, 20, 20] }],
      'f1td.tt.monza': [{ player: 'p', name: 'P', time: 40, sectors: [] }],
      'f1td.tt.ghost.baku.p': { track: 'baku', name: 'P', time: 60, dt: 0.05, x: [], y: [], h: [] },
      'f1td.tt.pb.baku': { track: 'baku', name: 'P', time: 60, dt: 0.05, x: [], y: [], h: [] },
      'f1td.tt.pb.acc-1.baku': { track: 'baku', name: 'P', time: 61, dt: 0.05, x: [], y: [], h: [] },
      'f1td.tt.track': 'baku',
    });
    const keys = [...kv.m.keys()];
    adjustStoredTimes(kv, keys, factors, 'test');
    const get = (k: string) => JSON.parse(kv.getItem(k)!);
    expect(get('f1td.tt.baku')[0].time).toBeCloseTo(60.6);
    expect(get('f1td.tt.baku')[0].sectors).toEqual([20.2, 20.2, 20.2]);
    expect(get('f1td.tt.monza')[0].time).toBe(40);
    expect(get('f1td.tt.ghost.baku.p').time).toBeCloseTo(60.6);
    expect(get('f1td.tt.ghost.baku.p').dt).toBeCloseTo(0.0505);
    expect(get('f1td.tt.pb.baku').time).toBeCloseTo(60.6);
    expect(get('f1td.tt.pb.acc-1.baku').time).toBeCloseTo(61.61);
    expect(get('f1td.tt.track')).toBe('baku');
    // Running again changes nothing.
    adjustStoredTimes(kv, keys, factors, 'test');
    expect(get('f1td.tt.baku')[0].time).toBeCloseTo(60.6);
  });
});
