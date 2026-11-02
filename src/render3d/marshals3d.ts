import * as THREE from 'three';
import type { Track, TrackSample } from '../track/track';

/**
 * Marshals round the lap (looks only): they stand by, and wave yellow flags under the safety car
 * and green at the restart. One more at the line waves the chequered flag.
 */

export type TrackFlag = 'yellow' | 'green' | null;

const FLAG_COLORS = { yellow: '#ffd400', green: '#22c55e' };
const MIN_POSTS = 6;
const MAX_POSTS = 14;
const POST_SPACING = 280;
/** Metres beyond the wall they stand, and past the line for the chequered flag. */
const WALL_GAP = 1.4;
const FLAG_HEIGHT = 2.1;

export interface MarshalOptions {
  blocked: (x: number, y: number, margin: number) => boolean;
  heightAt: (x: number, y: number) => number;
  groundAt?: (x: number, y: number) => number;
}

/** How many marshal posts a lap of this length gets. */
export function postCount(length: number): number {
  return Math.max(MIN_POSTS, Math.min(MAX_POSTS, Math.round(length / POST_SPACING)));
}

/** A flag's swing at this time (rad), each post a little out of step with the next. */
export function flagSwing(time: number, post: number): number {
  return Math.sin(time * 7 + post * 1.7) * 0.9;
}

interface Post {
  x: number;
  y: number;
  h: number;
  /** Which way it faces (rad about the vertical): towards the track. */
  face: number;
}

export class Marshals3d {
  readonly group = new THREE.Group();
  private readonly posts: Post[] = [];
  private readonly flags: THREE.InstancedMesh;
  private readonly poles: THREE.InstancedMesh;
  private readonly flagMat = new THREE.MeshBasicMaterial({ color: FLAG_COLORS.yellow, side: THREE.DoubleSide });
  private readonly disposables: { dispose(): void }[] = [this.flagMat];
  private readonly finish = new THREE.Group();
  private readonly finishCloth = new THREE.Group();
  private flag: TrackFlag = null;

  constructor(track: Track, opts: MarshalOptions) {
    const n = track.samples.length;
    const count = postCount(track.length);
    for (let i = 0; i < count; i++) {
      const post = this.findPost(track, Math.floor(((i + 0.5) / count) * n), opts);
      if (post) this.posts.push(post);
    }

    const body = new THREE.BoxGeometry(0.42, 1.05, 0.26).translate(0, 0.98, 0);
    const legs = new THREE.BoxGeometry(0.34, 0.5, 0.22).translate(0, 0.25, 0);
    const head = new THREE.BoxGeometry(0.22, 0.24, 0.22).translate(0, 1.64, 0);
    const orange = new THREE.MeshLambertMaterial({ color: '#f26a1b' });
    const dark = new THREE.MeshLambertMaterial({ color: '#2b2d33' });
    const white = new THREE.MeshLambertMaterial({ color: '#f1f1f1' });
    const poleMat = new THREE.MeshLambertMaterial({ color: '#d8d8d8' });
    const clothGeo = new THREE.PlaneGeometry(1.3, 0.9).translate(0.65, 0.42, 0);
    const poleGeo = new THREE.BoxGeometry(0.04, 1.4, 0.04).translate(0, 0.3, 0);
    this.disposables.push(body, legs, head, orange, dark, white, poleMat, clothGeo, poleGeo);

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const stand = (geo: THREE.BufferGeometry, mat: THREE.Material) => {
      const inst = new THREE.InstancedMesh(geo, mat, this.posts.length + 1);
      this.posts.forEach((p, i) => inst.setMatrixAt(i, m.compose(new THREE.Vector3(p.x, p.h, p.y), q.setFromAxisAngle(up, p.face), new THREE.Vector3(1, 1, 1))));
      inst.count = this.posts.length;
      inst.frustumCulled = false;
      this.group.add(inst);
    };
    stand(body, orange);
    stand(legs, dark);
    stand(head, white);

    this.flags = new THREE.InstancedMesh(clothGeo, this.flagMat, Math.max(1, this.posts.length));
    this.poles = new THREE.InstancedMesh(poleGeo, poleMat, Math.max(1, this.posts.length));
    this.flags.frustumCulled = this.poles.frustumCulled = false;
    this.flags.visible = this.poles.visible = false;
    this.group.add(this.flags, this.poles);

    this.buildFinish(track, opts, { body, legs, head, orange, dark, white, poleMat });
  }

  /** A spot beyond the wall near this sample, clear of the pits and any other part of the track. */
  private findPost(track: Track, start: number, opts: MarshalOptions): Post | null {
    const n = track.samples.length;
    for (let tries = 0; tries < 40; tries++) {
      const i = (start + tries * 3) % n;
      const s = track.samples[i];
      if (s.pit) continue;
      for (const side of s.curvature > 0 ? [-1, 1] : [1, -1]) {
        const off = (side === 1 ? s.wallR : s.wallL) + WALL_GAP;
        const x = s.x + s.nx * side * off;
        const y = s.y + s.ny * side * off;
        const hit = track.query(x, y);
        if (!hit || Math.abs(hit.d) - (hit.d >= 0 ? hit.sample.wallR : hit.sample.wallL) < 0.5) continue;
        if (opts.blocked(x, y, 2)) continue;
        return this.post(s, side, x, y, opts);
      }
    }
    return null;
  }

  private post(s: TrackSample, side: number, x: number, y: number, opts: MarshalOptions): Post {
    const h = Math.max(opts.heightAt(s.x, s.y), opts.groundAt?.(x, y) ?? -Infinity);
    // Three.js turns +x towards -z for a positive angle: this faces the arm out along the road.
    return { x, y, h, face: -Math.atan2(s.ny * -side, s.nx * -side) + Math.PI / 2 };
  }

  private buildFinish(
    track: Track,
    opts: MarshalOptions,
    parts: { body: THREE.BufferGeometry; legs: THREE.BufferGeometry; head: THREE.BufferGeometry; orange: THREE.Material; dark: THREE.Material; white: THREE.Material; poleMat: THREE.Material },
  ): void {
    // Just past the line, so a car stopped on it sees the flag ahead. Opposite the pit lane.
    const s = track.samples[6 % track.samples.length];
    const side = track.pit?.side === 'right' ? -1 : 1;
    const off = s.halfWidth + 2;
    const x = s.x + s.nx * side * off;
    const y = s.y + s.ny * side * off;
    this.finish.position.set(x, opts.heightAt(s.x, s.y), y);
    this.finish.rotation.y = -Math.atan2(s.ny * -side, s.nx * -side) + Math.PI / 2;
    this.finish.add(new THREE.Mesh(parts.body, parts.white), new THREE.Mesh(parts.legs, parts.dark), new THREE.Mesh(parts.head, parts.orange));

    const c = document.createElement('canvas');
    c.width = 96;
    c.height = 64;
    const g = c.getContext('2d')!;
    for (let i = 0; i < 12; i++) {
      for (let j = 0; j < 8; j++) {
        g.fillStyle = (i + j) % 2 === 0 ? '#101010' : '#f6f6f6';
        g.fillRect(i * 8, j * 8, 8, 8);
      }
    }
    const tex = new THREE.CanvasTexture(c);
    tex.magFilter = THREE.NearestFilter;
    tex.colorSpace = THREE.SRGBColorSpace;
    const clothGeo = new THREE.PlaneGeometry(2.7, 1.8).translate(1.35, 0.8, 0);
    const clothMat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide });
    const pole = new THREE.BoxGeometry(0.05, 2.4, 0.05).translate(0, 0.5, 0);
    this.disposables.push(tex, clothGeo, clothMat, pole);
    this.finishCloth.add(new THREE.Mesh(clothGeo, clothMat), new THREE.Mesh(pole, parts.poleMat));
    this.finishCloth.position.y = FLAG_HEIGHT;
    this.finishCloth.visible = false;
    this.finish.add(this.finishCloth);
    this.group.add(this.finish);
  }

  /** Call every frame with what the flags should show. */
  update(flag: TrackFlag, chequered: boolean, time: number): void {
    if (flag !== this.flag) {
      this.flag = flag;
      if (flag) this.flagMat.color.set(FLAG_COLORS[flag]);
      this.flags.visible = this.poles.visible = !!flag;
    }
    if (flag) {
      const m = new THREE.Matrix4();
      const e = new THREE.Euler();
      const pos = new THREE.Vector3();
      const q = new THREE.Quaternion();
      const one = new THREE.Vector3(1, 1, 1);
      this.posts.forEach((p, i) => {
        const swing = flagSwing(time, i);
        e.set(0, p.face + swing * 0.5, swing * 0.35, 'YXZ');
        m.compose(pos.set(p.x, p.h + FLAG_HEIGHT, p.y), q.setFromEuler(e), one);
        this.flags.setMatrixAt(i, m);
        this.poles.setMatrixAt(i, m);
      });
      this.flags.count = this.poles.count = this.posts.length;
      this.flags.instanceMatrix.needsUpdate = this.poles.instanceMatrix.needsUpdate = true;
    }
    this.finishCloth.visible = chequered;
    if (chequered) {
      const swing = flagSwing(time * 0.8, 0);
      this.finishCloth.rotation.set(0, swing * 0.8, swing * 0.3 + 0.15);
    }
  }

  get postsPlaced(): number {
    return this.posts.length;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.group.traverse((o) => {
      if (o instanceof THREE.InstancedMesh) o.dispose();
    });
  }
}
