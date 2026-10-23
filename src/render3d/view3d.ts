import * as THREE from 'three';
import type { Livery } from '../render/livery';
import type { Compound } from '../sim/tyres';
import type { Track } from '../track/track';
import { CarModel, EYE, type WheelInfo } from './carModel';
import { Scenery3d } from './scenery3d';
import { buildTrackMeshes, noiseTexture, TRACK_COLORS } from './trackMesh';

/**
 * First-person (3D) view of the race. Only a renderer: the cars are driven by exactly the
 * same simulation as the top-down view, so speeds, braking, DRS, ERS and wall hits are
 * identical. Kept cheap: flat-shaded low-poly shapes, no shadows or post-processing, fog to
 * limit the draw distance, and the resolution capped.
 */

export type Cam3d = 'cockpit' | 'tcam' | 'nose' | 'chase';
export const CAM3D_ORDER: Cam3d[] = ['cockpit', 'tcam', 'nose', 'chase'];
export const CAM3D_NAMES: Record<Cam3d, string> = {
  cockpit: 'COCKPIT',
  tcam: 'T-CAM (above the airbox)',
  nose: 'NOSE CAM (over the front wing)',
  chase: 'CHASE CAM',
};

/** Camera place and where it looks, in the car frame (x forward, y up, z right). */
const CAMS: Record<Cam3d, { eye: [number, number, number]; look: [number, number, number]; fov: number }> = {
  cockpit: { eye: EYE, look: [30, 0.2, 0], fov: 62 },
  tcam: { eye: [-0.95, 1.32, 0], look: [30, 0.1, 0], fov: 60 },
  nose: { eye: [1.95, 0.62, 0], look: [30, 0.05, 0], fov: 66 },
  chase: { eye: [-8.5, 2.7, 0], look: [6, 0.9, 0], fov: 58 },
};
/** Wider view at top speed (deg), for a sense of speed. */
const FOV_SPEED = 8;
const SKY_TOP = '#5f9bd8';
const SKY_HORIZON = '#cfe2f1';
const FOG_NEAR = 220;
const FOG_FAR = 1000;
/** Rendering never goes above this many device pixels per CSS pixel. */
const MAX_PIXEL_RATIO = 1.25;

export interface CarView {
  id: string;
  x: number;
  y: number;
  heading: number;
  steer: number;
  drsOpen: boolean;
  compound: Compound;
  livery: Livery;
  /** See-through replay car in this colour (time trial ghost). */
  ghost?: string;
}

export interface OwnCarView extends CarView {
  /** m/s, and yaw rate (rad/s) to look a little into corners. */
  speed: number;
  yawRate: number;
  wheel: WheelInfo;
}

export class View3D {
  readonly canvas: HTMLCanvasElement;
  mode: Cam3d = 'cockpit';
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  /** Our own car, drawn last over the world with its own near plane. */
  private readonly near = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(60, 1, 0.5, 2600);
  private readonly nearCamera = new THREE.PerspectiveCamera(60, 1, 0.02, 40);
  private readonly sky: THREE.Mesh;
  private readonly cars = new Map<string, { model: CarModel; key: string }>();
  private readonly disposables: { dispose(): void }[] = [];
  private chaseHeading: number | null = null;
  private look = 0;

  constructor(track: Track) {
    this.canvas = document.createElement('canvas');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.autoClear = false;
    this.renderer.setClearColor(SKY_HORIZON);
    this.scene.fog = new THREE.Fog(SKY_HORIZON, FOG_NEAR, FOG_FAR);

    for (const scene of [this.scene, this.near]) {
      scene.add(new THREE.HemisphereLight('#e8f1ff', '#4a5a3a', 1.6));
      const sun = new THREE.DirectionalLight('#fff6e0', 1.8);
      sun.position.set(0.5, 1, 0.3);
      scene.add(sun);
    }

    const noise = noiseTexture();
    const ground = new THREE.MeshLambertMaterial({ vertexColors: true, map: noise, side: THREE.DoubleSide });
    const solid = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    const paint = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
    const meshes = buildTrackMeshes(track);
    this.scene.add(new THREE.Mesh(meshes.ground, ground), new THREE.Mesh(meshes.walls, solid), new THREE.Mesh(meshes.paint, paint));
    this.disposables.push(noise, ground, solid, paint, meshes.ground, meshes.walls, meshes.paint);

    // The land outside the walls, a little below the track.
    const outsideGeo = new THREE.PlaneGeometry(12000, 12000).rotateX(-Math.PI / 2);
    const outsideMat = new THREE.MeshLambertMaterial({ color: TRACK_COLORS.outside });
    const outside = new THREE.Mesh(outsideGeo, outsideMat);
    const c = track.samples[0];
    outside.position.set(c.x, -0.12, c.y);
    this.scene.add(outside);
    this.disposables.push(outsideGeo, outsideMat);

    const scenery = new Scenery3d(track, solid);
    this.scene.add(scenery.group);
    scenery.group.traverse((o) => {
      if (o instanceof THREE.Mesh) this.disposables.push(o.geometry);
    });

    // Sky: a gradient dome that follows the camera.
    const skyGeo = new THREE.SphereGeometry(2400, 16, 10);
    const top = new THREE.Color(SKY_TOP);
    const horizon = new THREE.Color(SKY_HORIZON);
    const pos = skyGeo.getAttribute('position');
    const colors: number[] = [];
    const col = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const t = Math.max(0, pos.getY(i) / 2400);
      col.copy(horizon).lerp(top, Math.pow(t, 0.6));
      colors.push(col.r, col.g, col.b);
    }
    skyGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const skyMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false });
    this.sky = new THREE.Mesh(skyGeo, skyMat);
    this.sky.renderOrder = -1;
    this.scene.add(this.sky);
    this.disposables.push(skyGeo, skyMat);
  }

  setSize(width: number, height: number, devicePixelRatio: number): void {
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, MAX_PIXEL_RATIO));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = this.nearCamera.aspect = width / height;
  }

  /** Jump the chase camera straight behind the car (new car, reset). */
  snap(): void {
    this.chaseHeading = null;
  }

  render(own: OwnCarView, others: CarView[], dt: number): void {
    // Cars: create models as they appear, drop the ones that left.
    const seen = new Set<string>();
    for (const car of [own, ...others]) {
      seen.add(car.id);
      const key = `${car.livery.body}|${car.livery.wings}|${car.ghost ?? ''}|${car === own}`;
      let entry = this.cars.get(car.id);
      if (entry && entry.key !== key) {
        entry.model.group.removeFromParent();
        entry.model.dispose();
        entry = undefined;
      }
      if (!entry) {
        const model = new CarModel(car.livery, { ghost: car.ghost });
        if (car === own) {
          model.addSteeringWheel();
          this.near.add(model.group);
        } else this.scene.add(model.group);
        entry = { model, key };
        this.cars.set(car.id, entry);
      }
      entry.model.update(car.x, car.y, car.heading, car.steer, car.drsOpen, car.compound);
    }
    for (const [id, entry] of this.cars) {
      if (seen.has(id)) continue;
      entry.model.group.removeFromParent();
      entry.model.dispose();
      this.cars.delete(id);
    }
    const mine = this.cars.get(own.id)!.model;
    mine.driverVisible = this.mode === 'chase' || this.mode === 'nose';
    mine.wheel?.show(own.wheel);

    this.placeCamera(own, dt);
    this.sky.position.copy(this.camera.position);

    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    this.renderer.clearDepth();
    this.nearCamera.position.copy(this.camera.position);
    this.nearCamera.quaternion.copy(this.camera.quaternion);
    this.nearCamera.fov = this.camera.fov;
    this.nearCamera.updateProjectionMatrix();
    this.renderer.render(this.near, this.nearCamera);
  }

  private placeCamera(own: OwnCarView, dt: number): void {
    const cam = CAMS[this.mode];
    let heading = own.heading;
    if (this.mode === 'chase') {
      // The chase camera swings round behind the car a little late.
      if (this.chaseHeading === null) this.chaseHeading = heading;
      const diff = Math.atan2(Math.sin(heading - this.chaseHeading), Math.cos(heading - this.chaseHeading));
      this.chaseHeading += diff * Math.min(1, dt * 6);
      heading = this.chaseHeading;
    } else this.chaseHeading = null;
    // Look slightly into the corner.
    const target = Math.max(-0.12, Math.min(0.12, own.yawRate * 0.1));
    this.look += (target - this.look) * Math.min(1, dt * 4);
    const toWorld = (p: [number, number, number], yaw = 0): THREE.Vector3 => {
      const h = heading + yaw;
      const cos = Math.cos(h);
      const sin = Math.sin(h);
      return new THREE.Vector3(own.x + p[0] * cos - p[2] * sin, p[1], own.y + p[0] * sin + p[2] * cos);
    };
    // The chase camera is placed from the smoothed heading but stays centred on the car.
    const eye = toWorld(cam.eye);
    if (this.mode === 'chase') {
      const d = Math.hypot(cam.eye[0], cam.eye[2]);
      eye.set(own.x - Math.cos(heading) * d, cam.eye[1], own.y - Math.sin(heading) * d);
    }
    this.camera.position.copy(eye);
    this.camera.lookAt(toWorld(cam.look, this.mode === 'chase' ? 0 : this.look));
    this.camera.fov = cam.fov + FOV_SPEED * Math.min(1, own.speed / 90);
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    for (const { model } of this.cars.values()) model.dispose();
    this.cars.clear();
    for (const d of this.disposables) d.dispose();
    this.renderer.dispose();
    this.canvas.remove();
  }
}
