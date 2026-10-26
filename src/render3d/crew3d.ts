import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { CrewAction, CrewMember } from '../render/pitStops';
import { COMPOUNDS } from '../sim/tyres';

/**
 * Pit crew in 3D: low-poly people with jointed arms and legs (hips, thighs, shins and boots,
 * torso, upper arms, forearms and gloves, helmet with visor), posed by what they're doing:
 * striding out of the garage, standing by, kneeling with a wheel gun that shakes as it spins,
 * holding a tyre in both hands, leaning in with hands on the car, bracing on the jack, and
 * cheering the car away. Every body part is one instanced mesh for the whole pit lane.
 */

export const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);
export const WHITE = new THREE.Color('#ffffff');

/** An instanced mesh that is filled from scratch each frame. */
export class Batch {
  readonly mesh: THREE.InstancedMesh;
  private n = 0;
  constructor(geometry: THREE.BufferGeometry, material: THREE.Material, readonly capacity: number, colored: boolean) {
    this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    if (colored) for (let i = 0; i < capacity; i++) this.mesh.setColorAt(i, WHITE);
    for (let i = 0; i < capacity; i++) this.mesh.setMatrixAt(i, HIDDEN);
  }
  begin(): void {
    this.n = 0;
  }
  add(m: THREE.Matrix4, color?: THREE.Color): void {
    if (this.n >= this.capacity) return;
    this.mesh.setMatrixAt(this.n, m);
    if (color && this.mesh.instanceColor) this.mesh.setColorAt(this.n, color);
    this.n++;
  }
  end(): void {
    for (let i = this.n; i < this.capacity; i++) this.mesh.setMatrixAt(i, HIDDEN);
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

/** Body sizes (m). A person faces +x, y up; limbs hang along -y from their joint. */
const THIGH = 0.46;
const SHIN = 0.44;
const UPPER_ARM = 0.3;
const FOREARM = 0.28;
/** Hip height standing, shoulder height above the hips, and shoulder / hip spacing. */
const HIP = THIGH + SHIN - 0.06 + 0.085;
const SHOULDER = 0.5;
const SHOULDER_Z = 0.25;
const HIP_Z = 0.1;

export interface Limb {
  /** Swing at the hip / shoulder: + forward. */
  swing: number;
  /** Bend at the knee (- folds the shin back) / elbow (+ folds the forearm forward). */
  bend: number;
  /** Arm out to the side. */
  spread: number;
}

export interface Posture {
  /** Hip height (m). */
  hip: number;
  /** Forward lean of the upper body. */
  lean: number;
  /** Lift off the ground (a step or a jump). */
  bob: number;
  /** Left (+z) and right (-z). */
  legs: [Limb, Limb];
  arms: [Limb, Limb];
  /** A wheel gun in the right hand. */
  gun: boolean;
}

const limb = (swing: number, bend: number, spread = 0): Limb => ({ swing, bend, spread });

/** Height of a leg's knee and the sole of its boot above the ground (before any bob). */
export function legHeights(pose: Posture, side: 0 | 1): { knee: number; sole: number } {
  const leg = pose.legs[side];
  const knee = pose.hip - THIGH * Math.cos(leg.swing);
  return { knee, sole: knee - (SHIN - 0.06) * Math.cos(leg.swing + leg.bend) - 0.085 };
}

/** Joint angles for what a crew member is doing, `t` seconds into it. */
export function crewPose(action: CrewAction, busy: boolean, t: number, seed: number): Posture {
  const phase = t + seed * 0.37;
  switch (action) {
    case 'walk': {
      // A brisk stride: legs and opposite arms swing, a bob each step.
      const s = Math.sin(phase * 8);
      return {
        hip: HIP,
        lean: 0.08,
        bob: Math.abs(Math.cos(phase * 8)) * 0.05,
        legs: [limb(0.5 * s, -0.7 * Math.max(0, -s)), limb(-0.5 * s, -0.7 * Math.max(0, s))],
        arms: [limb(-0.55 * s, 0.45, 0.08), limb(0.55 * s, 0.45, 0.08)],
        gun: false,
      };
    }
    case 'gun': {
      // On one knee, arms out with the gun on the wheel nut; it shakes while it spins.
      const shake = busy ? Math.sin(phase * 70) * 0.05 : 0;
      return {
        hip: 0.56,
        lean: 0.3,
        bob: 0,
        legs: [limb(1.45, -1.5), limb(0.1, -1.62)],
        arms: [limb(1.15 + shake, 0.35, 0.05), limb(1.25 + shake, 0.2, 0.02)],
        gun: true,
      };
    }
    case 'carry':
      // A tyre held in front in both hands.
      return { hip: HIP, lean: -0.06, bob: 0, legs: [limb(0.06, 0), limb(-0.06, 0)], arms: [limb(0.75, 0.75, 0.32), limb(0.75, 0.75, 0.32)], gun: false };
    case 'hold':
      // Leaning in, hands on the car to keep it steady.
      return { hip: HIP - 0.06, lean: 0.55, bob: 0, legs: [limb(0.35, -0.3), limb(-0.25, -0.1)], arms: [limb(1.35, 0.15, 0.1), limb(1.35, 0.15, 0.1)], gun: false };
    case 'jack': {
      // Hands on the handle, leaning back to lift the car (pushed out when busy).
      const pull = busy ? 1 : 0.3;
      return {
        hip: HIP - 0.08,
        lean: 0.25 - 0.4 * pull,
        bob: 0,
        legs: [limb(0.45, -0.35), limb(-0.35, -0.15)],
        arms: [limb(0.7 + 0.35 * pull, 0.1, 0.12), limb(0.7 + 0.35 * pull, 0.1, 0.12)],
        gun: false,
      };
    }
    case 'cheer': {
      // Arms up, a little jump.
      const wave = Math.sin(phase * 14) * 0.15;
      return {
        hip: HIP,
        lean: -0.1,
        bob: Math.abs(Math.sin(phase * 9)) * 0.1,
        legs: [limb(0, 0), limb(0, 0)],
        arms: [limb(2.9 + wave, 0.3, 0.35), limb(2.9 - wave, 0.3, 0.35)],
        gun: false,
      };
    }
    case 'idle':
    default: {
      // Standing by, a little sway.
      const sway = Math.sin(phase * 1.6) * 0.06;
      return { hip: HIP, lean: 0.02, bob: 0, legs: [limb(0, 0), limb(0, 0)], arms: [limb(0.15 + sway, 0.35, 0.12), limb(0.15 - sway, 0.35, 0.12)], gun: false };
    }
  }
}

export class Crew3d {
  readonly group = new THREE.Group();
  private readonly torso: Batch;
  private readonly helmet: Batch;
  private readonly visor: Batch;
  private readonly thigh: Batch;
  private readonly shin: Batch;
  private readonly boot: Batch;
  private readonly upperArm: Batch;
  private readonly forearm: Batch;
  private readonly glove: Batch;
  private readonly gun: Batch;
  private readonly tyre: Batch;
  private readonly tyreBand: Batch;
  private readonly all: Batch[];
  /** How long each member has been doing what they're doing (for smooth poses). */
  private readonly since = new Map<string, { action: CrewAction; t: number }>();
  private readonly base = new THREE.Matrix4();
  private readonly hip = new THREE.Matrix4();
  private readonly joint = new THREE.Matrix4();
  private readonly lower = new THREE.Matrix4();
  private readonly tmp = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3(1, 1, 1);
  private readonly c = new THREE.Color();
  private readonly dim = new THREE.Color();
  private readonly up = new THREE.Vector3(0, 1, 0);

  constructor(capacity: number) {
    const lambert = (color: string) => new THREE.MeshLambertMaterial({ color, flatShading: true });
    // Overalls: a torso with a white stripe band (drawn in the team colour, the stripe as a
    // separate lighter box would cost another mesh: the collar and belt are left plain).
    const torso = mergeGeometries([
      new THREE.BoxGeometry(0.26, 0.56, 0.46).translate(0, 0.3, 0),
      new THREE.BoxGeometry(0.22, 0.12, 0.36).translate(0, 0.02, 0),
      new THREE.CylinderGeometry(0.07, 0.08, 0.1, 6).translate(0, 0.62, 0),
    ]);
    const helmet = new THREE.IcosahedronGeometry(0.15, 2).scale(1.08, 1, 1).translate(0.01, SHOULDER + 0.27, 0);
    const visor = new THREE.BoxGeometry(0.08, 0.08, 0.22).translate(0.12, SHOULDER + 0.27, 0);
    const thigh = new THREE.BoxGeometry(0.17, THIGH, 0.17).translate(0, -THIGH / 2, 0);
    const shin = new THREE.BoxGeometry(0.14, SHIN - 0.06, 0.14).translate(0, -(SHIN - 0.06) / 2, 0);
    const boot = new THREE.BoxGeometry(0.27, 0.09, 0.15).translate(0.05, -0.04, 0);
    const upperArm = new THREE.BoxGeometry(0.11, UPPER_ARM, 0.11).translate(0, -UPPER_ARM / 2, 0);
    const forearm = new THREE.BoxGeometry(0.1, FOREARM - 0.06, 0.1).translate(0, -(FOREARM - 0.06) / 2, 0);
    const glove = new THREE.BoxGeometry(0.11, 0.1, 0.12).translate(0, -FOREARM + 0.03, 0);
    // A wheel gun along the forearm, past the glove: body, barrel and socket.
    const gun = mergeGeometries([
      new THREE.BoxGeometry(0.12, 0.22, 0.14).translate(0, -FOREARM - 0.08, 0),
      new THREE.CylinderGeometry(0.035, 0.035, 0.22, 6).translate(0, -FOREARM - 0.28, 0),
      new THREE.CylinderGeometry(0.06, 0.06, 0.06, 8).translate(0, -FOREARM - 0.4, 0),
    ]);
    // A tyre held in front at chest height (in the body's frame), its sidewall in the compound colour.
    const tyre = new THREE.CylinderGeometry(0.33, 0.33, 0.3, 14).rotateX(Math.PI / 2).translate(0.42, 0.05, 0);
    const band = new THREE.TorusGeometry(0.26, 0.035, 4, 16).translate(0.42, 0.05, 0.16);
    const n = capacity;
    this.torso = new Batch(torso, lambert('#ffffff'), n, true);
    this.helmet = new Batch(helmet, lambert('#f2f2f2'), n, false);
    this.visor = new Batch(visor, lambert('#15181d'), n, false);
    this.thigh = new Batch(thigh, lambert('#ffffff'), n * 2, true);
    this.shin = new Batch(shin, lambert('#ffffff'), n * 2, true);
    this.boot = new Batch(boot, lambert('#151515'), n * 2, false);
    this.upperArm = new Batch(upperArm, lambert('#ffffff'), n * 2, true);
    this.forearm = new Batch(forearm, lambert('#ffffff'), n * 2, true);
    this.glove = new Batch(glove, lambert('#1b1b1b'), n * 2, false);
    this.gun = new Batch(gun, lambert('#3a3d44'), n, false);
    this.tyre = new Batch(tyre, lambert('#151515'), n, false);
    this.tyreBand = new Batch(band, new THREE.MeshBasicMaterial(), n, true);
    this.all = [this.torso, this.helmet, this.visor, this.thigh, this.shin, this.boot, this.upperArm, this.forearm, this.glove, this.gun, this.tyre, this.tyreBand];
    for (const b of this.all) this.group.add(b.mesh);
  }

  update(crew: readonly CrewMember[], time: number, heightAt: (x: number, y: number) => number): void {
    for (const b of this.all) b.begin();
    for (const m of crew) {
      const key = `${m.color}:${m.seed}`;
      let s = this.since.get(key);
      if (!s || s.action !== m.action) {
        s = { action: m.action, t: time };
        this.since.set(key, s);
      }
      this.person(m, crewPose(m.action, m.busy, time - s.t, m.seed), heightAt(m.x, m.y));
    }
    for (const b of this.all) b.end();
  }

  private person(m: CrewMember, pose: Posture, ground: number): void {
    const color = this.c.set(m.color);
    // Legs and arms a shade darker than the torso, so the limbs read against it.
    const limbs = this.dim.copy(color).multiplyScalar(0.78);
    this.q.setFromAxisAngle(this.up, -m.heading);
    this.p.set(m.x, ground + pose.bob, m.y);
    this.base.compose(this.p, this.q, this.s);

    // Legs hang from the hips (not leaning with the body).
    for (const side of [0, 1] as const) {
      const leg = pose.legs[side];
      const z = side === 0 ? HIP_Z : -HIP_Z;
      this.joint.copy(this.base).multiply(this.tmp.makeTranslation(0, pose.hip, z)).multiply(this.tmp.makeRotationZ(leg.swing));
      this.thigh.add(this.joint, limbs);
      this.lower.copy(this.joint).multiply(this.tmp.makeTranslation(0, -THIGH, 0)).multiply(this.tmp.makeRotationZ(leg.bend));
      this.shin.add(this.lower, limbs);
      // The boot at the end of the shin, kept flat whatever the knee does.
      this.lower.multiply(this.tmp.makeTranslation(0, -(SHIN - 0.06), 0)).multiply(this.tmp.makeRotationZ(-(leg.swing + leg.bend)));
      this.boot.add(this.lower);
    }

    // The upper body leans forward from the hips.
    this.hip.copy(this.base).multiply(this.tmp.makeTranslation(0, pose.hip, 0)).multiply(this.tmp.makeRotationZ(-pose.lean));
    this.torso.add(this.hip, color);
    this.helmet.add(this.hip);
    this.visor.add(this.hip);
    if (m.tyre) {
      this.tyre.add(this.hip);
      this.tyreBand.add(this.hip, this.c.set(COMPOUNDS[m.tyre].color));
      color.set(m.color);
    }

    for (const side of [0, 1] as const) {
      const arm = pose.arms[side];
      const z = side === 0 ? SHOULDER_Z : -SHOULDER_Z;
      // Out to the side (away from the body), then swung forward from the shoulder. The lean is
      // undone so arm angles are relative to upright (a leaning gunner still reaches level).
      this.joint
        .copy(this.hip)
        .multiply(this.tmp.makeTranslation(0, SHOULDER, z))
        .multiply(this.tmp.makeRotationZ(pose.lean))
        .multiply(this.tmp.makeRotationX(side === 0 ? -arm.spread : arm.spread))
        .multiply(this.tmp.makeRotationZ(arm.swing));
      this.upperArm.add(this.joint, color);
      this.lower.copy(this.joint).multiply(this.tmp.makeTranslation(0, -UPPER_ARM, 0)).multiply(this.tmp.makeRotationZ(arm.bend));
      this.forearm.add(this.lower, color);
      this.glove.add(this.lower);
      if (pose.gun && side === 1) this.gun.add(this.lower);
    }
  }

  dispose(): void {
    for (const b of this.all) {
      b.mesh.geometry.dispose();
      (b.mesh.material as THREE.Material).dispose();
    }
  }
}
