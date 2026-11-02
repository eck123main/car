import * as THREE from 'three';
import { Particles3d } from './particles3d';

/**
 * Things that only exist for a few seconds of a race (looks only), so they cost nothing the rest
 * of the time: the crew on the grid and the fly-over at lights out. Both are made the first time
 * they are needed and hidden after.
 */

/** Grid crew walk away at this pace (m/s) and are gone after this long (s). */
const WALK_SPEED = 3.2;
const WALK_TIME = 5;
const CREW_PER_CAR = 2;
const CREW_ACROSS = 2.3;

/** Where a grid crew member is across the road, seconds after they start walking off. */
export function crewOffset(side: number, walked: number): number {
  return side * (CREW_ACROSS + Math.max(0, walked) * WALK_SPEED);
}

export interface GridCar {
  x: number;
  y: number;
  heading: number;
  ground: number;
  color: string;
}

/** Two people beside each car on the grid, with umbrellas in the wet. They walk off when the lights start. */
export class GridCrew3d {
  readonly group = new THREE.Group();
  private readonly bodyGeo = new THREE.BoxGeometry(0.4, 0.68, 0.22).translate(0, 1.15, 0);
  private readonly legsGeo = new THREE.BoxGeometry(0.3, 0.82, 0.18).translate(0, 0.41, 0);
  private readonly legsMat = new THREE.MeshLambertMaterial({ color: '#23252b' });
  private readonly headGeo = new THREE.BoxGeometry(0.22, 0.24, 0.22).translate(0, 1.64, 0);
  private readonly brollyGeo = new THREE.ConeGeometry(0.85, 0.42, 8).translate(0, 2.2, 0);
  private readonly bodyMat = new THREE.MeshLambertMaterial();
  private readonly headMat = new THREE.MeshLambertMaterial({ color: '#e2b48c' });
  private readonly brollyMat = new THREE.MeshLambertMaterial({ color: '#f2f2f2' });
  private bodies: THREE.InstancedMesh | null = null;
  private legs: THREE.InstancedMesh | null = null;
  private heads: THREE.InstancedMesh | null = null;
  private brollies: THREE.InstancedMesh | null = null;
  private cars: GridCar[] = [];
  private walked = -1;

  /** Stand beside these cars (they're parked: this is only done when the grid forms). */
  place(cars: readonly GridCar[]): void {
    this.cars = [...cars];
    this.free();
    const n = cars.length * CREW_PER_CAR;
    this.bodies = new THREE.InstancedMesh(this.bodyGeo, this.bodyMat, n);
    this.legs = new THREE.InstancedMesh(this.legsGeo, this.legsMat, n);
    this.heads = new THREE.InstancedMesh(this.headGeo, this.headMat, n);
    this.brollies = new THREE.InstancedMesh(this.brollyGeo, this.brollyMat, n);
    for (const m of [this.bodies, this.legs, this.heads, this.brollies]) m.frustumCulled = false;
    const c = new THREE.Color();
    cars.forEach((car, i) => {
      c.set(car.color);
      this.bodies!.setColorAt(i * 2, c);
      this.bodies!.setColorAt(i * 2 + 1, c);
    });
    this.group.add(this.bodies, this.legs, this.heads, this.brollies);
    this.walked = -1;
    this.layOut(0);
    this.group.visible = true;
  }

  private layOut(walked: number): void {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const one = new THREE.Vector3(1, 1, 1);
    const up = new THREE.Vector3(0, 1, 0);
    this.cars.forEach((car, i) => {
      const nx = -Math.sin(car.heading);
      const ny = Math.cos(car.heading);
      q.setFromAxisAngle(up, walked > 0 ? -car.heading : Math.PI / 2 - car.heading);
      [-1, 1].forEach((side, j) => {
        const off = crewOffset(side, walked);
        m.compose(pos.set(car.x + nx * off, car.ground, car.y + ny * off), q, one);
        for (const mesh of [this.bodies!, this.legs!, this.heads!, this.brollies!]) mesh.setMatrixAt(i * 2 + j, m);
      });
    });
    for (const mesh of [this.bodies!, this.legs!, this.heads!, this.brollies!]) mesh.instanceMatrix.needsUpdate = true;
  }

  /** walking: the lights have started. Only touches the matrices while they are moving. */
  update(walking: boolean, wet: boolean, dt: number): void {
    if (!this.group.visible || !this.bodies) return;
    this.brollies!.visible = wet;
    if (!walking) return;
    this.walked = Math.max(0, this.walked) + dt;
    if (this.walked > WALK_TIME) {
      this.group.visible = false;
      return;
    }
    this.layOut(this.walked);
  }

  hide(): void {
    this.group.visible = false;
  }

  private free(): void {
    for (const m of [this.bodies, this.legs, this.heads, this.brollies]) {
      if (!m) continue;
      this.group.remove(m);
      m.dispose();
    }
  }

  dispose(): void {
    this.free();
    for (const d of [this.legsGeo, this.legsMat, this.bodyGeo, this.headGeo, this.brollyGeo, this.bodyMat, this.headMat, this.brollyMat]) d.dispose();
  }
}

const JET_SPEED = 120;
const JET_FROM = -280;
const JET_TO = 540;
const JET_HEIGHT = 50;
const TRAILS = ['#ff3b30', '#ffffff', '#2f7bff'];

/** Three jets over the start straight at lights out, trailing coloured smoke. */
export class Flyover3d {
  readonly group = new THREE.Group();
  private readonly geo = jetGeometry();
  private readonly mat = new THREE.MeshLambertMaterial({ color: '#c4cad2', flatShading: true, side: THREE.DoubleSide });
  private readonly jets = new THREE.InstancedMesh(this.geo, this.mat, 3);
  private readonly smoke = new Particles3d(260);
  private readonly colors = TRAILS.map((c) => new THREE.Color(c));
  private s = Infinity;
  private owed = 0;
  private start = { x: 0, y: 0, tx: 1, ty: 0, h: 0 };

  constructor() {
    this.jets.frustumCulled = false;
    this.group.add(this.jets, this.smoke.mesh);
    this.group.visible = false;
  }

  /** Go, along a line through this point of the straight. */
  fly(x: number, y: number, tx: number, ty: number, h: number): void {
    this.start = { x, y, tx, ty, h: h + JET_HEIGHT };
    this.s = JET_FROM;
    this.group.visible = true;
    this.jets.visible = true;
  }

  get flying(): boolean {
    return this.group.visible;
  }

  update(dt: number, scale: number): void {
    if (!this.group.visible) return;
    this.s += JET_SPEED * dt;
    const { x, y, tx, ty, h } = this.start;
    const heading = Math.atan2(ty, tx);
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -heading);
    const m = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const one = new THREE.Vector3(1, 1, 1);
    const inAir = this.s < JET_TO;
    this.jets.visible = inAir;
    if (inAir) {
      this.owed += 40 * dt;
      const puffs = Math.floor(this.owed);
      this.owed -= puffs;
      for (let i = 0; i < 3; i++) {
        const across = (i - 1) * 16;
        const along = this.s - Math.abs(i - 1) * 14;
        const px = x + tx * along - ty * across;
        const py = y + ty * along + tx * across;
        this.jets.setMatrixAt(i, m.compose(pos.set(px, h, py), q, one));
        for (let p = 0; p < puffs; p++) {
          this.smoke.spawn({
            x: px - tx * 5, y: h, z: py - ty * 5, vx: 0, vy: -0.3, vz: 0,
            life: 2.6, size: 3, endSize: 8, color: this.colors[i], alpha: 0.7,
          });
        }
      }
      this.jets.instanceMatrix.needsUpdate = true;
    }
    this.smoke.update(dt, scale);
    // Done, and the last of the smoke has gone.
    if (!inAir && this.smoke.count === 0) this.group.visible = false;
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
    this.jets.dispose();
    this.smoke.dispose();
  }
}

/** A dart: pointed body and a delta wing, nose along +x. A dozen triangles. */
function jetGeometry(): THREE.BufferGeometry {
  const nose = [7, 0, 0];
  const tail = [-6, 0, 0];
  const top = [-3, 1, 0];
  const low = [-3, -0.6, 0];
  const l = [-3, 0, -1];
  const r = [-3, 0, 1];
  const wingL = [-5, 0, -6];
  const wingR = [-5, 0, 6];
  const front = [2, 0, 0];
  const fin = [-6, 2.6, 0];
  const tri = (...p: number[][]) => p.flat();
  const v = [
    ...tri(nose, l, top), ...tri(nose, top, r), ...tri(nose, low, l), ...tri(nose, r, low),
    ...tri(tail, top, l), ...tri(tail, r, top), ...tri(tail, l, low), ...tri(tail, low, r),
    ...tri(front, wingL, tail), ...tri(front, tail, wingR),
    ...tri(top, fin, tail),
  ];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  geo.computeVertexNormals();
  return geo;
}
