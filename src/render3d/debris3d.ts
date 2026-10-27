import * as THREE from 'three';
import type { Livery } from '../render/livery';
import { debrisOpacity, type Debris } from '../sim/debris';
import { COMPOUNDS } from '../sim/tyres';
import { frontWingGeometry, rearWingGeometry } from './carModel';

const CARBON = '#1c1d20';
const TYRE = '#161616';
/** Wing geometry is built where it sits on the car; these move it to the middle of the piece. */
const FRONT_WING_X = 2.5;
const REAR_WING_X = -2.57;
const REAR_WING_Y = 0.66;
const WHEEL_RADIUS = 0.35;

interface Piece {
  object: THREE.Object3D;
  /** Wheels: the tyre and rim, rolled about the axle. */
  roll?: THREE.Object3D;
  rolled: number;
  /** Wheels: 0 upright, 1 lying flat. */
  flat: number;
}

/**
 * Parts knocked off cars, in 3D: wings in the paint of their car, wheels that roll and bounce
 * (and end up lying flat), and carbon shards. Plain meshes, at most a few dozen; each piece
 * shrinks away at the end of its time on track.
 */
export class Debris3d {
  readonly group = new THREE.Group();
  private readonly pieces = new Map<number, Piece>();
  private readonly geos = new Map<string, THREE.BufferGeometry>();
  private readonly body = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  private readonly carbon = new THREE.MeshLambertMaterial({ color: CARBON });
  private readonly tyre = new THREE.MeshLambertMaterial({ color: TYRE });
  private readonly rims = new Map<string, THREE.MeshLambertMaterial>();
  private readonly wheelGeo = new THREE.CylinderGeometry(WHEEL_RADIUS, WHEEL_RADIUS, 0.38, 14).rotateX(Math.PI / 2);
  private readonly ringGeo = new THREE.TorusGeometry(0.25, 0.03, 4, 14);
  private readonly shardGeo = new THREE.BoxGeometry(0.32, 0.03, 0.2);

  constructor(private readonly heightAt: (x: number, y: number, index: number | null) => number) {}

  update(debris: readonly Debris[], liveryOf: (owner: string) => Livery, time: number, dt: number): void {
    const seen = new Set<number>();
    for (const p of debris) {
      seen.add(p.id);
      let piece = this.pieces.get(p.id);
      if (!piece) {
        piece = this.make(p, liveryOf(p.owner));
        this.pieces.set(p.id, piece);
        this.group.add(piece.object);
      }
      this.place(piece, p, time, dt);
    }
    for (const [id, piece] of this.pieces) {
      if (seen.has(id)) continue;
      piece.object.removeFromParent();
      this.pieces.delete(id);
    }
  }

  private make(p: Debris, livery: Livery): Piece {
    const object = new THREE.Group();
    if (p.kind === 'frontWing' || p.kind === 'rearWing') {
      const key = `${p.kind}|${livery.wings}|${livery.endplates}`;
      let geo = this.geos.get(key);
      if (!geo) {
        geo = p.kind === 'frontWing' ? frontWingGeometry(livery).translate(-FRONT_WING_X, 0, 0) : rearWingGeometry(livery).translate(-REAR_WING_X, -REAR_WING_Y, 0);
        this.geos.set(key, geo);
      }
      object.add(new THREE.Mesh(geo, this.body));
      return { object, rolled: 0, flat: 0 };
    }
    if (p.kind === 'wheel') {
      const roll = new THREE.Group();
      roll.add(new THREE.Mesh(this.wheelGeo, this.tyre));
      const color = p.compound ? COMPOUNDS[p.compound].color : '#888888';
      let rim = this.rims.get(color);
      if (!rim) {
        rim = new THREE.MeshLambertMaterial({ color });
        this.rims.set(color, rim);
      }
      for (const side of [-1, 1]) {
        const ring = new THREE.Mesh(this.ringGeo, rim);
        ring.position.z = side * 0.195;
        roll.add(ring);
      }
      object.add(roll);
      return { object, roll, rolled: 0, flat: 0 };
    }
    object.add(new THREE.Mesh(this.shardGeo, this.carbon));
    return { object, rolled: 0, flat: 0 };
  }

  private place(piece: Piece, p: Debris, time: number, dt: number): void {
    const o = piece.object;
    const ground = this.heightAt(p.x, p.y, p.trackIndex);
    const speed = Math.hypot(p.vx, p.vy);
    o.scale.setScalar(Math.max(0.01, debrisOpacity(p, time)));
    if (piece.roll) {
      // A wheel rolls the way it's going while it has speed, and falls flat once it stops.
      piece.flat += ((speed < 1.5 && p.z === 0 ? 1 : 0) - piece.flat) * Math.min(1, dt * 3);
      piece.rolled += (speed * dt) / WHEEL_RADIUS;
      piece.roll.rotation.z = -piece.rolled;
      o.rotation.set(piece.flat * (Math.PI / 2), speed > 1.5 ? -Math.atan2(p.vy, p.vx) : -p.heading, 0, 'YXZ');
      o.position.set(p.x, ground + p.z + WHEEL_RADIUS * (1 - piece.flat) + 0.2 * piece.flat, p.y);
      return;
    }
    // Wings and shards turn with their spin, and tumble while in the air.
    const tumble = p.z > 0 ? Math.sin(time * 9 + p.id) * Math.min(0.8, p.z) : 0;
    o.rotation.set(tumble, -p.heading, 0, 'YXZ');
    o.position.set(p.x, ground + p.z + 0.03, p.y);
  }

  dispose(): void {
    for (const g of this.geos.values()) g.dispose();
    for (const m of this.rims.values()) m.dispose();
    this.wheelGeo.dispose();
    this.ringGeo.dispose();
    this.shardGeo.dispose();
    this.body.dispose();
    this.carbon.dispose();
    this.tyre.dispose();
  }
}
