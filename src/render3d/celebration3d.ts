import * as THREE from 'three';
import type { Track } from '../track/track';
import { Particles3d } from './particles3d';

/**
 * The end of a race (looks only): the top three cars on steps on the start straight, confetti
 * coming down and fireworks overhead.
 */

export interface PodiumSpot {
  x: number;
  y: number;
  heading: number;
  /** Height of the step (m). */
  lift: number;
}

/** Where the winner (0), second (1) and third (2) stand: past the line, the winner in the middle and ahead. */
export function podiumSpots(track: Track): PodiumSpot[] {
  const s = track.samples[Math.min(track.samples.length - 1, 22)];
  const heading = Math.atan2(s.ty, s.tx);
  const place = (across: number, along: number, lift: number): PodiumSpot => ({
    x: s.x + s.nx * across + s.tx * along,
    y: s.y + s.ny * across + s.ty * along,
    heading,
    lift,
  });
  return [place(0, 1, 0.9), place(-4.6, -1, 0.6), place(4.6, -1, 0.35)];
}

/** Camera going slowly round the podium; starts ahead of the cars, looking back at them. */
export function podiumCamera(center: { x: number; y: number; heading: number }, ground: number, t: number): { eye: [number, number, number]; look: [number, number, number]; fov: number } {
  const angle = center.heading + Math.sin(t * 0.22) * 0.55;
  const r = 15 - Math.min(3, t * 0.35);
  return {
    eye: [center.x + Math.cos(angle) * r, ground + 3.2, center.y + Math.sin(angle) * r],
    look: [center.x, ground + 1.1, center.y],
    fov: 50,
  };
}

const STEP_COLORS = ['#e8c44a', '#c6ccd4', '#c98a52'];
const CONFETTI_RATE = 90;
const SHOW_RATE = 1.4;

export class Celebration3d {
  readonly group = new THREE.Group();
  private readonly confetti = new Particles3d(700, { soft: 0.75 });
  private readonly sparks: Particles3d;
  private readonly steps = new THREE.Group();
  private readonly disposables: { dispose(): void }[] = [];
  private center = new THREE.Vector3();
  private colors: THREE.Color[] = [new THREE.Color('#ffffff')];
  private owed = 0;
  private untilBurst = 0.2;

  /** dark: glowing fireworks; on a bright sky glow vanishes, so they're solid colour. */
  constructor(dark: boolean) {
    this.sparks = new Particles3d(1400, { soft: dark ? 0.15 : 0.5, additive: dark });
    this.group.add(this.steps, this.confetti.mesh, this.sparks.mesh);
    this.group.visible = false;
  }

  /** Put the steps out at these spots; `ground`: road height at each. Colours: the drivers'. */
  show(spots: readonly PodiumSpot[], ground: readonly number[], colors: readonly string[]): void {
    this.steps.clear();
    spots.forEach((s, i) => {
      const geo = new THREE.BoxGeometry(6, s.lift, 3).translate(0, s.lift / 2, 0);
      const mat = new THREE.MeshLambertMaterial({ color: STEP_COLORS[i] });
      this.disposables.push(geo, mat);
      const m = new THREE.Mesh(geo, mat);
      m.position.set(s.x, ground[i], s.y);
      m.rotation.y = -s.heading;
      this.steps.add(m);
    });
    this.center.set(spots[0].x, ground[0], spots[0].y);
    this.colors = [...colors, '#ffffff', '#ffd400'].map((c) => new THREE.Color(c));
    this.group.visible = true;
  }

  hide(): void {
    this.group.visible = false;
  }

  update(dt: number, scale: number): void {
    if (!this.group.visible) return;
    const pick = () => this.colors[Math.floor(Math.random() * this.colors.length)];
    // Confetti falling all round the cars.
    this.owed += CONFETTI_RATE * Math.min(dt, 0.05);
    for (; this.owed >= 1; this.owed--) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 16;
      this.confetti.spawn({
        x: this.center.x + Math.cos(a) * r, y: this.center.y + 9 + Math.random() * 7, z: this.center.z + Math.sin(a) * r,
        vx: (Math.random() - 0.5) * 1.6, vy: -1.2, vz: (Math.random() - 0.5) * 1.6,
        life: 4 + Math.random() * 2, size: 0.17, endSize: 0.13, color: pick(), alpha: 1.3, gravity: 0.25, drag: 0.4, floor: this.center.y + 0.03,
      });
    }
    // A firework now and then, high up.
    this.untilBurst -= dt;
    if (this.untilBurst <= 0) {
      this.untilBurst = (0.5 + Math.random()) / SHOW_RATE;
      this.burst(pick());
    }
    this.confetti.update(dt, scale);
    this.sparks.update(dt, scale);
  }

  private burst(color: THREE.Color): void {
    const a = Math.random() * Math.PI * 2;
    const r = 25 + Math.random() * 45;
    const x = this.center.x + Math.cos(a) * r;
    const y = this.center.y + 28 + Math.random() * 28;
    const z = this.center.z + Math.sin(a) * r;
    for (let i = 0; i < 110; i++) {
      // Evenly over a sphere.
      const u = Math.random() * 2 - 1;
      const t = Math.random() * Math.PI * 2;
      const c = Math.sqrt(1 - u * u);
      const speed = 13 + Math.random() * 4;
      this.sparks.spawn({
        x, y, z,
        vx: c * Math.cos(t) * speed, vy: u * speed, vz: c * Math.sin(t) * speed,
        life: 1.1 + Math.random() * 0.6, size: 1.3, endSize: 0.4, color, alpha: 1.6, gravity: 5, drag: 1.2,
      });
    }
  }

  dispose(): void {
    this.confetti.dispose();
    this.sparks.dispose();
    for (const d of this.disposables) d.dispose();
  }
}
