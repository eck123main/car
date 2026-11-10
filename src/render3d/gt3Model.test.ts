import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { armJoints, raisedHand } from './carModel';
import { GT3_COCKPIT, GT3_EYE, raceNumber } from './gt3Model';
import { FRONT_AXLE, halfWidth, REAR_AXLE, shellGeometry, sideBottom, topHeight } from './gt3Skin';
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

describe('GT3 body shell', () => {
  it('covers the tyres, with the arch openings clear above them', () => {
    expect(halfWidth(FRONT_AXLE)).toBeGreaterThanOrEqual(0.83 + 0.15);
    expect(halfWidth(REAR_AXLE)).toBeGreaterThanOrEqual(0.84 + 0.165);
    for (const axle of [FRONT_AXLE, REAR_AXLE]) expect(sideBottom(axle)).toBeGreaterThan(0.34 + 0.345);
  });

  it('shows the driver both front fender humps over the dash', () => {
    // Line of sight from the eyes over the dash's top edge, out to the front wheels.
    const [ex, ey] = GT3_EYE;
    const sight = ey + ((0.84 - ey) / (0.62 - ex)) * (FRONT_AXLE - ex);
    expect(topHeight(FRONT_AXLE, 0.8)).toBeGreaterThan(sight + 0.1);
    expect(topHeight(FRONT_AXLE, 0)).toBeLessThan(sight + 0.05);
  });

  it('builds a clean mesh, open over the cabin', () => {
    const geo = shellGeometry();
    const pos = geo.getAttribute('position').array as Float32Array;
    expect(pos.every(Number.isFinite)).toBe(true);
    const box = new THREE.Box3().setFromBufferAttribute(geo.getAttribute('position') as THREE.BufferAttribute);
    expect(box.max.x).toBeCloseTo(2.33, 2);
    expect(box.max.z).toBeLessThan(1.05);
    // Nothing of the shell over the seats below the roof.
    const idx = geo.getIndex()!.array;
    for (let t = 0; t < idx.length; t += 3) {
      const c = [0, 1, 2].map((k) => [0, 1, 2].reduce((sum, v) => sum + pos[idx[t + v] * 3 + k], 0) / 3);
      if (c[0] > -0.9 && c[0] < 0.55 && Math.abs(c[2]) < 0.7) expect(c[1] < 0.2 || c[1] > 1.26).toBe(true);
    }
  });
});
