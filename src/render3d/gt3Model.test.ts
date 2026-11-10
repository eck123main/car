import { describe, expect, it } from 'vitest';
import { armJoints, raisedHand } from './carModel';
import { GT3_COCKPIT, GT3_EYE, raceNumber } from './gt3Model';
import { GT3_CAMS, camNames } from './view3d';

describe('GT3 cockpit', () => {
  it("the driver's arms keep their length and stay in the driver's half of the cabin", () => {
    for (const angle of [-2.3, -1.2, 0, 0.6, 1.5, 2.3]) {
      for (const side of [-1, 1]) {
        const { shoulder, elbow, wrist } = armJoints(angle, side, GT3_COCKPIT);
        expect(shoulder.distanceTo(elbow)).toBeCloseTo(0.29, 3);
        expect(elbow.distanceTo(wrist)).toBeCloseTo(0.28, 3);
        // Between the door bars (z -0.8) and the switch panel (z -0.15); above the seat.
        expect(elbow.z).toBeGreaterThan(-0.78);
        expect(elbow.z).toBeLessThan(-0.05);
        expect(elbow.y).toBeGreaterThan(0.35);
      }
    }
  });

  it('the arms cross in a hairpin, round the wheel in front of the driver', () => {
    expect(armJoints(2, -1, GT3_COCKPIT).wrist.z).toBeGreaterThan(GT3_COCKPIT.wheel[2]);
    expect(armJoints(0, -1, GT3_COCKPIT).wrist.z).toBeLessThan(GT3_COCKPIT.wheel[2]);
  });

  it('the hand raised at the finish stays under the roof', () => {
    for (const t of [0, 0.2, 0.5]) {
      const [, y, z] = raisedHand(t, true, GT3_COCKPIT);
      expect(y).toBeLessThan(1.25);
      expect(Math.abs(z - GT3_COCKPIT.wheel[2])).toBeLessThan(0.4);
    }
  });

  it("the driver's eyes are under the roof, behind the wheel, on the left", () => {
    const [x, y, z] = GT3_EYE;
    expect(y).toBeLessThan(1.25);
    expect(x).toBeLessThan(GT3_COCKPIT.wheel[0] - 0.4);
    expect(z).toBeLessThan(0);
    expect(GT3_CAMS.cockpit.inside).toBe(true);
  });

  it('names its cameras for where they are on a GT3', () => {
    expect(camNames('gt3').tcam).toBe('ROOF CAM');
    expect(camNames('gt3').nose).toBe('BONNET CAM');
    expect(camNames('f1').tcam).toContain('T-CAM');
  });

  it('gives a livery the same race number every time', () => {
    const l = { body: '#d40000', nose: '#d40000', wings: '#1a1a1a', endplates: '#d40000', helmet: '#ffd400' };
    expect(raceNumber(l)).toBe(raceNumber({ ...l }));
    expect(raceNumber(l)).toBeGreaterThanOrEqual(2);
    expect(raceNumber(l)).toBeLessThanOrEqual(99);
  });
});
