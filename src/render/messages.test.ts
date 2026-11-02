import { describe, expect, it } from 'vitest';
import { radioLine } from './messages';

const base = { position: 3, gapAhead: 6, gapBehind: 6, lapsLeft: 5, wear: 0.1 };

describe('Team radio', () => {
  it('says what matters most', () => {
    expect(radioLine({ ...base, lapsLeft: 1, gapBehind: 0.2 })).toBe('LAST LAP');
    expect(radioLine({ ...base, gapBehind: 0.5, gapAhead: 0.5 })).toBe('DEFEND');
    expect(radioLine({ ...base, gapAhead: 0.5 })).toBe('ATTACK');
    expect(radioLine({ ...base, wear: 0.7 })).toBe('TYRES 70%');
    expect(radioLine({ ...base, gapAhead: 2.34 })).toBe('GAP 2.3');
    expect(radioLine({ ...base, position: 1, gapAhead: null })).toBe('GOOD PACE');
    expect(radioLine(base)).toBe('P3 PUSH');
  });

  it('every line fits the display', () => {
    for (const l of ['LAST LAP', '2 TO GO', 'TYRES 100%', 'GAP 3.9', 'GOOD PACE', 'P10 PUSH']) expect(l.length).toBeLessThanOrEqual(10);
  });
});
