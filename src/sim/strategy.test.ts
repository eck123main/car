import { describe, expect, it } from 'vitest';
import { pitAdvice, type StrategyInput } from './strategy';

const base: StrategyInput = {
  laps: 6,
  currentLap: 1,
  mandatoryStop: true,
  stops: 0,
  compoundsUsed: ['medium'],
  compound: 'medium',
  nextTyre: 'hard',
  wear: 0,
  damage: 0,
  wetness: 0,
};

describe('pitAdvice', () => {
  it('gives a pit window for the mandatory stop and only says box inside it', () => {
    const lap1 = pitAdvice(base);
    expect(lap1.window).not.toBeNull();
    expect(lap1.boxNow).toBe(false);
    const [first, last] = lap1.window!;
    expect(first).toBeGreaterThanOrEqual(1);
    expect(last).toBeLessThan(base.laps!);
    // Somewhere in the window it says box; never on every lap.
    const boxLaps = [1, 2, 3, 4, 5, 6].filter((lap) => pitAdvice({ ...base, currentLap: lap, wear: (lap - 1) * 0.09 }).boxNow);
    expect(boxLaps.length).toBeGreaterThan(0);
    expect(boxLaps.length).toBeLessThan(base.laps!);
  });

  it('goes quiet once the stop is done', () => {
    const done = pitAdvice({ ...base, currentLap: 4, stops: 1, compoundsUsed: ['medium', 'hard'] });
    expect(done.window).toBeNull();
    expect(done.boxNow).toBe(false);
  });

  it('says nothing about pitting in practice unless something is wrong', () => {
    expect(pitAdvice({ ...base, laps: null, mandatoryStop: false }).boxNow).toBe(false);
    expect(pitAdvice({ ...base, laps: null, mandatoryStop: false, wear: 0.8 }).boxNow).toBe(true);
  });

  it('calls you in for damage or the wrong tyres for the weather', () => {
    expect(pitAdvice({ ...base, damage: 0.5 }).reason).toMatch(/damage/i);
    expect(pitAdvice({ ...base, wetness: 0.6 }).reason).toMatch(/wet/i);
    expect(pitAdvice({ ...base, compound: 'wet', wetness: 0.1 }).reason).toMatch(/slicks/i);
  });

  it('never says box on the final lap without a reason', () => {
    const final = pitAdvice({ ...base, currentLap: 6, stops: 1, compoundsUsed: ['medium', 'hard'], wear: 0.8 });
    expect(final.boxNow).toBe(false);
  });
});
