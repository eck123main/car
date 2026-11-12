import { describe, expect, it } from 'vitest';
import { ADJUSTMENTS, adjustAllStoredTimes, adjustStoredTimes, clearStoredLaps } from './adjustTimes';

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

  it('applies every adjustment once, each on top of the last', () => {
    const kv = store({ 'f1td.tt.monaco': [{ player: 'p', name: 'P', time: 50 }] });
    const keys = [...kv.m.keys()];
    adjustAllStoredTimes(kv, keys);
    adjustAllStoredTimes(kv, keys);
    const expected = ADJUSTMENTS.reduce((t, a) => t * (a.factors.monaco ?? 1), 50);
    expect(JSON.parse(kv.getItem('f1td.tt.monaco')!)[0].time).toBeCloseTo(expected, 2);
  });
});

describe('clearing a class after a big physics change', () => {
  it('forgets that class\'s laps, ghosts and bests once, and nothing else', () => {
    const store = new Map<string, string>([
      ['f1td.tt.monza@gt3', '[{"time":80}]'],
      ['f1td.tt.ghost.monza@gt3.p1', '{"time":80,"dt":0.05}'],
      ['f1td.tt.pb.monza@gt3', '{"time":80,"dt":0.05}'],
      ['f1td.tt.pb.acc1.monza@gt3', '{"time":80,"dt":0.05}'],
      ['f1td.tt.monza', '[{"time":60}]'],
      ['f1td.tt.pb.monza', '{"time":60,"dt":0.05}'],
    ]);
    const kv = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
    clearStoredLaps(kv, [...store.keys()], 'gt3', 'test-clear');
    expect([...store.keys()].filter((k) => k.startsWith('f1td.tt.'))).toEqual(['f1td.tt.monza', 'f1td.tt.pb.monza']);
    // Once only: a lap set afterwards stays.
    store.set('f1td.tt.monza@gt3', '[{"time":70}]');
    clearStoredLaps(kv, [...store.keys()], 'gt3', 'test-clear');
    expect(store.get('f1td.tt.monza@gt3')).toBe('[{"time":70}]');
  });
});
