import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { describe, expect, it } from 'vitest';
import { prepareBody } from './customBody';
import { FRONT_AXLE, REAR_AXLE } from './gt3Skin';

/** A glTF-style car: facing +z, y up, in centimetres, under a parent node like Sketchfab's. */
function fakeCar(opts: { backwards?: boolean; rearWidth?: number; wheelNames?: [string, string] } = {}): THREE.Object3D {
  const root = new THREE.Group();
  root.name = 'Sketchfab_model';
  root.scale.setScalar(100);
  const paint = new THREE.MeshStandardMaterial({ name: 'CarPaint', metalness: 1, roughness: 0.2 });
  const glass = new THREE.MeshStandardMaterial({ name: 'Glass', transparent: true, opacity: 0.4 });
  const tyre = new THREE.MeshStandardMaterial({ name: 'Rubber' });
  // Body 2 m wide, 1.1 m tall, 4.8 m long, sitting 0.1 m up; two panels in the same paint.
  for (const z of [-1.2, 1.2]) {
    const panel = new THREE.Mesh(new THREE.BoxGeometry(2, 1.1, 2.4), paint);
    panel.position.set(0, 0.65, z);
    root.add(panel);
  }
  const screen = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.4, 0.1), glass);
  screen.position.set(0, 1.1, 0.6);
  root.add(screen);
  // Wheels (radius 0.36) with a 3 m wheelbase, front axle at z = +1.6.
  for (const [x, z] of [[-0.85, 1.6], [0.85, 1.6], [-0.85, -1.4], [0.85, -1.4]]) {
    const front = z > 0;
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, front ? 0.3 : (opts.rearWidth ?? 0.3), 12).rotateZ(Math.PI / 2), tyre);
    w.name = opts.wheelNames ? opts.wheelNames[front ? 0 : 1] : 'Wheel';
    w.position.set(x, 0.36, z);
    root.add(w);
  }
  if (opts.backwards) {
    const outer = new THREE.Group();
    root.rotation.y = Math.PI;
    outer.add(root);
    return outer;
  }
  return root;
}

function bounds(parts: { geometry: THREE.BufferGeometry }[]): THREE.Box3 {
  const box = new THREE.Box3();
  for (const p of parts) {
    p.geometry.computeBoundingBox();
    box.union(p.geometry.boundingBox!);
  }
  return box;
}

describe('loaded car bodies', () => {
  it('turns, scales and places the body so its axles sit on ours', () => {
    const ready = prepareBody(fakeCar(), {}, 'gt3')!;
    expect(ready.fit).toBe('axles');
    const box = bounds(ready.parts);
    const scale = (FRONT_AXLE - REAR_AXLE) / 3;
    // Length along x now, nose forward (the nose is 2.3 m ahead of the axles' midpoint).
    expect(box.max.x - box.min.x).toBeCloseTo(4.8 * scale, 3);
    const mid = (FRONT_AXLE + REAR_AXLE) / 2;
    expect(box.max.x).toBeCloseTo(mid + 2.3 * scale, 3);
    expect(box.max.z - box.min.z).toBeCloseTo(2 * scale, 3);
    expect((box.max.z + box.min.z) / 2).toBeCloseTo(0, 3);
    // Wheels on the ground: the body floor was 0.1 m above it.
    expect(box.min.y).toBeCloseTo(0.1 * scale, 3);
  });

  it('hides the wheels, merges per material and redoes PBR as Phong', () => {
    const ready = prepareBody(fakeCar(), {}, 'gt3')!;
    expect(ready.parts.length).toBe(2);
    const paint = ready.parts.find((p) => p.material.name === 'CarPaint')!;
    expect(paint.tinted).toBe(true);
    expect(paint.material).toBeInstanceOf(THREE.MeshPhongMaterial);
    expect(ready.parts.find((p) => p.material.name === 'Glass')!.tinted).toBe(false);
  });

  it('fits by length when no wheels are found, and can be turned round', () => {
    const ready = prepareBody(fakeCar(), { hide: 'nothing-matches', turn: 180, tint: false }, 'lmh')!;
    expect(ready.fit).toBe('length');
    expect(ready.parts.every((p) => !p.tinted)).toBe(true);
    const box = bounds(ready.parts);
    expect(box.max.x - box.min.x).toBeCloseTo(4.75, 3);
    expect(box.min.y).toBeCloseTo(0, 3);
  });

  it('finds the front of a model facing the other way, by tyre width or by name', () => {
    for (const car of [fakeCar({ backwards: true, rearWidth: 0.38 }), fakeCar({ backwards: true, wheelNames: ['Wheel_FL', 'Wheel_RR'] })]) {
      const box = bounds(prepareBody(car, {}, 'gt3')!.parts);
      const scale = (FRONT_AXLE - REAR_AXLE) / 3;
      expect(box.max.x).toBeCloseTo((FRONT_AXLE + REAR_AXLE) / 2 + 2.3 * scale, 3);
    }
  });

  it('fits a model whose four wheels are one mesh, facing backwards', () => {
    const car = fakeCar({ backwards: true, rearWidth: 0.38 });
    // Merge the four wheel meshes into one, as some exporters do.
    car.updateMatrixWorld(true);
    const wheels: THREE.Mesh[] = [];
    car.traverse((o) => {
      if (o.name === 'Wheel') wheels.push(o as THREE.Mesh);
    });
    const merged = mergeGeometries(wheels.map((w) => w.geometry.clone().applyMatrix4(w.matrixWorld)))!;
    for (const w of wheels) w.removeFromParent();
    const one = new THREE.Mesh(merged, wheels[0].material);
    one.name = 'Wheels';
    car.add(one);
    const ready = prepareBody(car, {}, 'gt3')!;
    expect(ready.fit).toBe('axles');
    const box = bounds(ready.parts);
    const scale = (FRONT_AXLE - REAR_AXLE) / 3;
    expect(box.max.x).toBeCloseTo((FRONT_AXLE + REAR_AXLE) / 2 + 2.3 * scale, 3);
    expect(box.min.y).toBeCloseTo(0.1 * scale, 3);
  });

  it('has nothing for the F1 car', () => {
    expect(prepareBody(fakeCar(), {}, 'f1')).toBeNull();
  });
});
