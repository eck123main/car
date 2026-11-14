import { describe, expect, it } from 'vitest';
import { armJoints, raisedHand } from './carModel';
import { halfWidth, LMH_COCKPIT, LMH_EYE, lmhRearWingGeometry, lmhSplitterGeometry, topHeight } from './lmhModel';
import { camNames, LMH_CAMS } from './view3d';

const LIVERY = { body: '#d40000', nose: '#d40000', wings: '#1a1a1a', endplates: '#d40000', helmet: '#ffd400' };

describe('Hypercar model', () => {
  it("the driver's eyes are under the canopy, behind the wheel, right of the middle", () => {
    const [x, y, z] = LMH_EYE;
    expect(topHeight(x, z)).toBeGreaterThan(y + 0.1);
    expect(x).toBeLessThan(LMH_COCKPIT.wheel[0] - 0.3);
    expect(z).toBeGreaterThan(0);
    expect(LMH_CAMS.cockpit.inside).toBe(true);
  });

  it("the driver's arms stay under the canopy, in the driver's half", () => {
    for (const angle of [-2.3, -1.2, 0, 0.6, 1.5, 2.3]) {
      for (const side of [-1, 1]) {
        const { elbow, wrist } = armJoints(angle, side, LMH_COCKPIT);
        for (const p of [elbow, wrist]) {
          expect(p.y, `${angle} ${side}`).toBeLessThan(topHeight(p.x, p.z) - 0.03);
          expect(p.y).toBeGreaterThan(0.3);
          expect(Math.abs(p.z - LMH_COCKPIT.wheel[2])).toBeLessThan(0.45);
        }
      }
    }
  });

  it('the hand raised at the finish stays under the canopy', () => {
    for (const t of [0, 0.2, 0.5]) {
      const [x, y, z] = raisedHand(t, true, LMH_COCKPIT);
      expect(y).toBeLessThan(topHeight(x, z));
    }
  });

  it('covers the tyres with its fenders', () => {
    // Wheels 0.82 m out, ~0.33 m wide: the fenders reach past them.
    expect(halfWidth(1.65)).toBeGreaterThan(0.82 + 0.155);
    expect(halfWidth(-1.5)).toBeGreaterThanOrEqual(0.82 + 0.17);
    // Pulled in along the sides between them.
    expect(halfWidth(0.1)).toBeLessThan(0.8);
  });

  it('builds its parts with no broken geometry', () => {
    for (const g of [lmhSplitterGeometry(), lmhRearWingGeometry(LIVERY)]) {
      const pos = g.getAttribute('position').array as Float32Array;
      expect(pos.length).toBeGreaterThan(0);
      expect(pos.every(Number.isFinite)).toBe(true);
    }
  });

  it('names its cameras for where they are on a Hypercar', () => {
    expect(camNames('lmh').tail).toBe('FIN CAM');
    expect(camNames('lmh').wing).toBe('SPLITTER CAM');
  });
});
