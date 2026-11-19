import { describe, expect, it } from 'vitest';
import { skillRun } from '../../../scripts/bot-skill';
import { CAR_CLASS_ORDER } from '../carClass';
import { DIFFICULTIES } from './botDriver';

/** Every level drives every car cleanly, and Easy < Medium < Hard clearly in each one. */
describe('bot skill levels', () => {
  for (const cls of CAR_CLASS_ORDER) {
    it(`${cls}: easy, medium and hard are clean and clearly apart at Silverstone`, () => {
      const [easy, medium, hard] = DIFFICULTIES.map((level) => {
        const r = skillRun('silverstone', cls, level, 1);
        expect(r.wrecks + r.dirty, `${cls} ${level}`).toBe(0);
        expect(r.clean.length, `${cls} ${level}`).toBe(1);
        return r.clean[0];
      });
      // F1: Easy ~10% and Medium ~4% off Hard; the other cars are set to match.
      expect(medium / hard).toBeGreaterThan(1.025);
      expect(easy / medium).toBeGreaterThan(1.04);
    }, 120_000);
  }
});
