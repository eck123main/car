import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MAX_CREW, type PitScene } from '../render/pitStops';
import { COMPOUNDS } from '../sim/tyres';

/**
 * Pit stops in 3D, from the same `PitScene` the top-down view draws: painted boxes with the
 * driver's name board, a light on a post at each box, and the crew (team-coloured overalls,
 * white helmets, tyres in the compound's colours) walking out, working round the car on its
 * jacks with wheel guns flickering, then the release smoke and rubber. Low-poly and instanced:
 * a handful of draw calls for the whole pit lane.
 */

type HeightAt = (x: number, y: number) => number;

const BOXES = 10;
/** Box paint: four edges and the stop bar per box. */
const PAINT = BOXES * 5;
const SPARKS = 48;
const JACKS = 2 * BOXES;
const SMOKE = 6 * BOXES;
const RUBBER = 2 * BOXES;

const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

/** An instanced mesh that is filled from scratch each frame. */
class Batch {
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
    this.mesh.count = this.capacity;
  }
}

const WHITE = new THREE.Color('#ffffff');
const POST = new THREE.MeshLambertMaterial({ color: '#2a2a2a' });

export class Pit3d {
  readonly group = new THREE.Group();
  private readonly torso: Batch;
  private readonly legs: Batch;
  private readonly helmet: Batch;
  private readonly tyre: Batch;
  private readonly tyreBand: Batch;
  private readonly sparks: Batch;
  private readonly jacks: Batch;
  private readonly posts: Batch;
  private readonly lamps: Batch;
  private readonly paint: Batch;
  private readonly fill: Batch;
  private readonly smoke: Batch;
  private readonly rubber: Batch;
  /** Name boards, rebuilt only when the drivers change. */
  private boards = new THREE.Group();
  private boardsKey = '';
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly c = new THREE.Color();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private time = 0;

  constructor(private readonly heightAt: HeightAt) {
    const lambert = (color?: string) => new THREE.MeshLambertMaterial({ color: color ?? '#ffffff', flatShading: true });
    const flat = (opts: THREE.MeshBasicMaterialParameters) =>
      new THREE.MeshBasicMaterial({ polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4, depthWrite: false, ...opts });
    // A crew member faces +x: torso and arms, legs, helmet with a dark visor.
    const torso = mergeGeometries([
      new THREE.BoxGeometry(0.32, 0.62, 0.5).translate(0, 1.13, 0),
      new THREE.BoxGeometry(0.42, 0.14, 0.14).translate(0.14, 1.05, 0.3),
      new THREE.BoxGeometry(0.42, 0.14, 0.14).translate(0.14, 1.05, -0.3),
    ]);
    const legs = mergeGeometries([new THREE.BoxGeometry(0.24, 0.82, 0.18).translate(0, 0.41, 0.12), new THREE.BoxGeometry(0.24, 0.82, 0.18).translate(0, 0.41, -0.12)]);
    const helmet = mergeGeometries([new THREE.IcosahedronGeometry(0.15, 2).translate(0, 1.59, 0)]);
    // A tyre held in front at waist height, its sidewall band in the compound colour.
    const tyre = new THREE.CylinderGeometry(0.33, 0.33, 0.3, 14).rotateX(Math.PI / 2).translate(0.5, 0.95, 0);
    const band = new THREE.TorusGeometry(0.26, 0.035, 4, 16).translate(0.5, 0.95, 0.16);
    this.torso = new Batch(torso, lambert(), MAX_CREW, true);
    this.legs = new Batch(legs, lambert('#1d1e22'), MAX_CREW, false);
    this.helmet = new Batch(helmet, lambert('#f2f2f2'), MAX_CREW, false);
    this.tyre = new Batch(tyre, lambert('#151515'), MAX_CREW, false);
    this.tyreBand = new Batch(band, new THREE.MeshBasicMaterial(), MAX_CREW, true);
    this.sparks = new Batch(new THREE.IcosahedronGeometry(0.11, 0), new THREE.MeshBasicMaterial({ color: '#ffe680' }), SPARKS, false);
    // A trolley jack: a low base and a handle rising towards the jack man (+x).
    const jack = mergeGeometries([
      new THREE.BoxGeometry(0.7, 0.14, 0.32).translate(0, 0.1, 0),
      new THREE.BoxGeometry(1.1, 0.06, 0.06).rotateZ(0.5).translate(0.75, 0.42, 0),
    ]);
    this.jacks = new Batch(jack, lambert('#c9c9c9'), JACKS, false);
    this.posts = new Batch(new THREE.CylinderGeometry(0.05, 0.05, 2.2, 6).translate(0, 1.1, 0), lambert('#2a2a2a'), BOXES, false);
    this.lamps = new Batch(new THREE.BoxGeometry(0.34, 0.34, 0.34).translate(0, 2.3, 0), new THREE.MeshBasicMaterial(), BOXES, true);
    // Flat paint on the lane (a unit square, scaled per piece).
    const square = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.paint = new Batch(square, flat({}), PAINT, true);
    this.fill = new Batch(square, flat({ transparent: true, opacity: 0.22 }), BOXES, true);
    this.rubber = new Batch(square, flat({ color: '#0a0a0a', transparent: true, opacity: 0.6 }), RUBBER, false);
    this.smoke = new Batch(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshLambertMaterial({ color: '#e6e6e6', transparent: true, opacity: 0.55, depthWrite: false }), SMOKE, false);
    for (const b of [this.fill, this.paint, this.rubber, this.legs, this.torso, this.helmet, this.tyre, this.tyreBand, this.jacks, this.posts, this.lamps, this.sparks, this.smoke]) this.group.add(b.mesh);
    this.group.add(this.boards);
  }

  update(scene: PitScene, dt: number): void {
    this.time += dt;
    const all = [this.torso, this.legs, this.helmet, this.tyre, this.tyreBand, this.sparks, this.jacks, this.posts, this.lamps, this.paint, this.fill, this.smoke, this.rubber];
    for (const b of all) b.begin();

    for (const box of scene.boxes) {
      const h = this.heightAt(box.x, box.y) + 0.03;
      this.c.set(box.color);
      // Tinted box, its outline, and the white stop bar where the nose goes.
      this.flat(this.fill, box.x, box.y, h, box.heading, 0, 0, 7, 3.6, this.c);
      this.flat(this.paint, box.x, box.y, h + 0.005, box.heading, 0, -1.8, 7, 0.25, this.c);
      this.flat(this.paint, box.x, box.y, h + 0.005, box.heading, 0, 1.8, 7, 0.25, this.c);
      this.flat(this.paint, box.x, box.y, h + 0.005, box.heading, -3.5, 0, 0.25, 3.6, this.c);
      this.flat(this.paint, box.x, box.y, h + 0.005, box.heading, 3.25, 0, 0.3, 2.8, WHITE);
    }
    for (const l of scene.lights) {
      const h = this.heightAt(l.x, l.y);
      this.m.makeTranslation(l.x, h, l.y);
      this.posts.add(this.m);
      this.lamps.add(this.m, this.c.set(l.state === 'green' ? '#2eff4a' : l.state === 'red' ? '#ff2a1f' : '#3a2a2a'));
    }
    for (const m of scene.crew) {
      const h = this.heightAt(m.x, m.y) + (m.walking ? Math.abs(Math.sin(this.time * 9 + m.x)) * 0.06 : 0);
      this.place(m.x, m.y, h, m.heading, 1);
      this.torso.add(this.m, this.c.set(m.color));
      this.legs.add(this.m);
      this.helmet.add(this.m);
      if (m.tyre) {
        this.tyre.add(this.m);
        this.tyreBand.add(this.m, this.c.set(COMPOUNDS[m.tyre].color));
      }
    }
    for (const s of scene.sparks) {
      this.m.makeTranslation(s.x, this.heightAt(s.x, s.y) + 0.33, s.y);
      this.sparks.add(this.m);
    }
    for (const j of scene.jacks) {
      this.place(j.x, j.y, this.heightAt(j.x, j.y), j.heading, 1);
      this.jacks.add(this.m);
    }
    for (const r of scene.rubber) {
      if (r.alpha <= 0) continue;
      const len = Math.hypot(r.x1 - r.x0, r.y1 - r.y0);
      const mx = (r.x0 + r.x1) / 2;
      const my = (r.y0 + r.y1) / 2;
      // Fades by thinning out (one shared opacity for all marks).
      this.flat(this.rubber, mx, my, this.heightAt(mx, my) + 0.04, Math.atan2(r.y1 - r.y0, r.x1 - r.x0), 0, 0, len, 0.36 * r.alpha, WHITE);
    }
    for (const s of scene.smoke) {
      const r = s.radius * (0.4 + 0.6 * s.alpha);
      this.q.identity();
      this.p.set(s.x, this.heightAt(s.x, s.y) + 0.3 + r * 0.6, s.y);
      this.s.set(r, r * 0.8, r);
      this.m.compose(this.p, this.q, this.s);
      this.smoke.add(this.m);
    }
    for (const b of all) b.end();
    this.updateBoards(scene);
  }

  dispose(): void {
    this.clearBoards();
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
    POST.dispose();
  }

  /** A crew member, jack, etc. at (x, y), facing `heading`. */
  private place(x: number, y: number, h: number, heading: number, scale: number): void {
    this.q.setFromAxisAngle(this.up, -heading);
    this.p.set(x, h, y);
    this.s.set(scale, scale, scale);
    this.m.compose(this.p, this.q, this.s);
  }

  /** A flat painted piece: `along` / `across` from (x, y) in the box's frame, `len` x `wide` m. */
  private flat(batch: Batch, x: number, y: number, h: number, heading: number, along: number, across: number, len: number, wide: number, color: THREE.Color): void {
    const cos = Math.cos(heading);
    const sin = Math.sin(heading);
    this.q.setFromAxisAngle(this.up, -heading);
    this.p.set(x + cos * along - sin * across, h, y + sin * along + cos * across);
    this.s.set(len, 1, wide);
    this.m.compose(this.p, this.q, this.s);
    batch.add(this.m, color);
  }

  private clearBoards(): void {
    for (const child of this.boards.children) {
      const mesh = child as THREE.Mesh;
      mesh.geometry.dispose();
      if (mesh.material === POST) continue;
      const mat = mesh.material as THREE.MeshBasicMaterial;
      mat.map?.dispose();
      mat.dispose();
    }
    this.boards.clear();
  }

  /** Name boards above each box on the garage side, facing the lane. */
  private updateBoards(scene: PitScene): void {
    const key = scene.boxes.map((b) => `${b.name}${b.color}`).join('|');
    if (key === this.boardsKey) return;
    this.boardsKey = key;
    this.clearBoards();
    for (const box of scene.boxes) {
      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 96;
      const c = canvas.getContext('2d')!;
      c.fillStyle = '#121317';
      c.fillRect(0, 0, 256, 96);
      c.fillStyle = box.color;
      c.fillRect(0, 0, 256, 14);
      c.fillStyle = '#ffffff';
      c.font = 'italic 900 58px system-ui, sans-serif';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(box.name, 128, 58);
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      const board = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.98), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
      // Over the garage edge of the box, facing across the lane.
      const o = 2.6 * box.garage;
      const x = box.x - Math.sin(box.heading) * o;
      const y = box.y + Math.cos(box.heading) * o;
      const ground = this.heightAt(x, y);
      board.position.set(x, ground + 2.6, y);
      // The plane faces +z, which turns to the box's left: flip it to face the lane.
      board.rotation.y = -box.heading + (box.garage > 0 ? Math.PI : 0);
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.1, 6), POST);
      post.position.set(x, ground + 1.05, y);
      this.boards.add(board, post);
    }
  }
}
