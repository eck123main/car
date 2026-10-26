import * as THREE from 'three';
import type { Livery } from '../render/livery';
import type { Compound } from '../sim/tyres';
import type { Track } from '../track/track';
import { CarModel, EYE, mirrorUv, SafetyCarModel, type WheelInfo } from './carModel';
import { Items3d, type ItemsFrame } from './items3d';
import { Pit3d } from './pit3d';
import type { PitScene } from '../render/pitStops';
import { Scenery3d } from './scenery3d';
import { Landmarks, lookOf, waterOf } from './landmarks';
import { Terrain } from './terrain';
import { buildTrackMeshes, noiseTexture } from './trackMesh';
import type { SceneryDef } from '../track/types';

/**
 * First-person (3D) view of the race. Only a renderer: the cars are driven by exactly the
 * same simulation as the top-down view, so speeds, braking, DRS, ERS and wall hits are
 * identical. Kept cheap: flat-shaded low-poly shapes, no shadows or post-processing, fog to
 * limit the draw distance, and the resolution capped.
 */

export type Cam3d = 'cockpit' | 'clear' | 'tcam' | 'nose' | 'wing' | 'tail' | 'chase' | 'far';
export const CAM3D_ORDER: Cam3d[] = ['cockpit', 'clear', 'tcam', 'nose', 'wing', 'tail', 'chase', 'far'];
export const CAM3D_NAMES: Record<Cam3d, string> = {
  cockpit: 'COCKPIT',
  clear: 'COCKPIT (no halo)',
  tcam: 'T-CAM (above the airbox)',
  nose: 'NOSE CAM',
  wing: 'FRONT WING CAM',
  tail: 'REAR WING CAM',
  chase: 'CHASE CAM',
  far: 'CHASE CAM (far)',
};

interface CamDef {
  /** Camera place and where it looks, in the car frame (x forward, y up, z right). */
  eye: [number, number, number];
  look: [number, number, number];
  fov: number;
  /** Inside the cockpit: no helmet. */
  inside?: boolean;
  /** Hide the halo (it blocks the middle of the view). */
  noHalo?: boolean;
  /** Behind the car, swinging round a little late. */
  chase?: boolean;
}

/** Looking behind: from above the driver's head, over the airbox and rear wing. */
const LOOK_BACK: CamDef = { eye: [0.3, 1.45, 0], look: [-30, 0.4, 0], fov: 62 };

const CAMS: Record<Cam3d, CamDef> = {
  cockpit: { eye: EYE, look: [30, 0.2, 0], fov: 62, inside: true },
  clear: { eye: [EYE[0], EYE[1] + 0.04, 0], look: [30, 0.2, 0], fov: 64, inside: true, noHalo: true },
  tcam: { eye: [-0.95, 1.32, 0], look: [30, 0.1, 0], fov: 60 },
  nose: { eye: [1.95, 0.62, 0], look: [30, 0.05, 0], fov: 66 },
  wing: { eye: [2.25, 0.38, -0.3], look: [30, 0.15, -0.3], fov: 68 },
  tail: { eye: [-2.95, 1.3, 0], look: [30, 0.2, 0], fov: 64 },
  chase: { eye: [-8.5, 2.7, 0], look: [6, 0.9, 0], fov: 58, chase: true },
  far: { eye: [-13, 4.2, 0], look: [8, 0.9, 0], fov: 55, chase: true },
};
/** Wider view at top speed (deg), for a sense of speed. */
const FOV_SPEED = 8;
/** Rendering never goes above this many device pixels per CSS pixel. */
const MAX_PIXEL_RATIO = 1.25;
/** Rear-view mirror picture (px), its vertical field of view (deg, ~70° across) and draw distance (m). */
const MIRROR_SIZE = [512, 128] as const;
const MIRROR_FOV = 20;
const MIRROR_FAR = 600;

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
  /** How see-through a ghost is (default 0.35). */
  ghostOpacity?: number;
  /** Which stretch of track it's on (Car.trackIndex), for the height of the road there. */
  trackIndex?: number | null;
}

/** The safety car, while it is on track; lights: flashing (deployed, not coming in). */
export interface SafetyCarView {
  x: number;
  y: number;
  heading: number;
  lights: boolean;
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
  private pitch = 0;
  private pitchReady = false;
  /**
   * Rear-view mirror: what's behind, drawn small into a texture every other frame. Inside the
   * car it shows on the wing mirrors; from the other cameras as a mirror at the top of the screen.
   */
  mirror = true;
  /** Held look-back key: the camera looks behind the car, from above the driver's head. */
  lookBack = false;
  private readonly mirrorTarget = new THREE.WebGLRenderTarget(MIRROR_SIZE[0], MIRROR_SIZE[1]);
  private readonly mirrorCamera = new THREE.PerspectiveCamera(MIRROR_FOV, MIRROR_SIZE[0] / MIRROR_SIZE[1], 0.5, MIRROR_FAR);
  private readonly screenMirror = new THREE.Scene();
  private readonly screenCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly screenFrame: THREE.Mesh;
  private readonly screenGlass: THREE.Mesh;
  private mirrorFrame = 0;
  private safetyCar: SafetyCarModel | null = null;
  /** Party mode items, made the first time a frame has some. */
  private items: Items3d | null = null;
  /** Pit boxes and crews, made the first time a frame has them. */
  private pit: Pit3d | null = null;
  private time = 0;
  private width = 1;
  private readonly track: Track;

  constructor(track: Track) {
    this.canvas = document.createElement('canvas');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.autoClear = false;
    // Each circuit's own look: night races, sunsets, desert, mountains.
    const look = lookOf(track.scenery);
    this.track = track;
    this.renderer.setClearColor(look.skyHorizon);
    this.scene.fog = new THREE.Fog(look.skyHorizon, look.fogNear, look.fogFar);

    for (const scene of [this.scene, this.near]) {
      scene.add(new THREE.HemisphereLight(look.night ? '#9fb4ff' : '#e8f1ff', '#4a5a3a', look.ambient));
      const sun = new THREE.DirectionalLight(look.sunColor, look.sun);
      sun.position.set(0.5, 1, 0.3);
      scene.add(sun);
    }

    const noise = noiseTexture();
    const ground = new THREE.MeshLambertMaterial({ vertexColors: true, map: noise, side: THREE.DoubleSide });
    const solid = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    const paint = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
    // The land, following the track's real heights (and under any water).
    const water = waterOf(track);
    const terrain = new Terrain(track, (x, y) => water.levelAt(x, y));
    const meshes = buildTrackMeshes(track, look, (x, y) => terrain.heightAt(x, y));
    this.scene.add(new THREE.Mesh(meshes.ground, ground), new THREE.Mesh(meshes.walls, solid), new THREE.Mesh(meshes.paint, paint));
    this.disposables.push(noise, ground, solid, paint, meshes.ground, meshes.walls, meshes.paint);

    // The land outside the walls, and a flat plain beyond it to the horizon.
    const landGeo = terrain.geometry();
    const landMat = new THREE.MeshLambertMaterial({ color: look.outside, map: noise });
    this.scene.add(new THREE.Mesh(landGeo, landMat));
    const outsideGeo = terrain.outskirts();
    const outsideMat = new THREE.MeshLambertMaterial({ color: look.outside });
    this.scene.add(new THREE.Mesh(outsideGeo, outsideMat));
    this.disposables.push(landGeo, landMat, outsideGeo, outsideMat);

    const landmarks = new Landmarks(track, look, terrain, water);
    this.scene.add(landmarks.group);
    this.disposables.push(landmarks);
    const scenery = new Scenery3d(track, solid, {
      trees: look.trees,
      blocked: (x, y, margin) => landmarks.blocked(x, y, margin),
      hills: hillColor(track.scenery),
      alps: track.scenery?.alps,
      heightAt: (x, y) => this.heightAt(x, y),
      groundAt: (x, y) => terrain.heightAt(x, y),
      base: terrain.base,
    });
    this.scene.add(scenery.group);
    scenery.group.traverse((o) => {
      if (o instanceof THREE.Mesh) this.disposables.push(o.geometry);
    });

    // Sky: a gradient dome that follows the camera.
    const skyGeo = new THREE.SphereGeometry(2400, 16, 10);
    const top = new THREE.Color(look.skyTop);
    const horizon = new THREE.Color(look.skyHorizon);
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

    // The on-screen mirror: a dark frame and the glass, each a full-viewport quad.
    const quad = new THREE.PlaneGeometry(2, 2);
    mirrorUv(quad, 0, 1);
    const frameMat = new THREE.MeshBasicMaterial({ color: '#111216' });
    const glassMat = new THREE.MeshBasicMaterial({ map: this.mirrorTarget.texture });
    this.screenFrame = new THREE.Mesh(quad, frameMat);
    this.screenGlass = new THREE.Mesh(quad, glassMat);
    this.screenMirror.add(this.screenFrame, this.screenGlass);
    this.disposables.push(quad, frameMat, glassMat, this.mirrorTarget);
  }

  setSize(width: number, height: number, devicePixelRatio: number): void {
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, MAX_PIXEL_RATIO));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = this.nearCamera.aspect = width / height;
    this.width = width;
  }

  /** Where a point (sim x, y, height h) is on screen in CSS px, or null if behind the camera. */
  project(x: number, y: number, h: number, trackIndex: number | null = null): { x: number; y: number; distance: number } | null {
    const p = new THREE.Vector3(x, h + this.heightAt(x, y, trackIndex), y);
    const distance = p.distanceTo(this.camera.position);
    p.project(this.camera);
    if (p.z > 1 || p.z < -1) return null;
    const size = this.renderer.getSize(new THREE.Vector2());
    return { x: ((p.x + 1) / 2) * size.x, y: ((1 - p.y) / 2) * size.y, distance };
  }

  /** Jump the chase camera straight behind the car (new car, reset). */
  snap(): void {
    this.chaseHeading = null;
    this.pitchReady = false;
  }

  render(own: OwnCarView, others: CarView[], dt: number, safetyCar: SafetyCarView | null = null, items: ItemsFrame | null = null, pit: PitScene | null = null): void {
    this.time += dt;
    // Nose up on a climb, down on a descent (eased a little, like the car's suspension).
    const pitchTarget = Math.atan(this.uphill(own));
    this.pitch = this.pitchReady ? this.pitch + (pitchTarget - this.pitch) * Math.min(1, dt * 10) : pitchTarget;
    this.pitchReady = true;
    if (safetyCar) {
      if (!this.safetyCar) {
        this.safetyCar = new SafetyCarModel();
        this.scene.add(this.safetyCar.group);
      }
      this.safetyCar.update(safetyCar.x, safetyCar.y, safetyCar.heading, safetyCar.lights, this.time);
    }
    if (this.safetyCar) this.safetyCar.group.visible = !!safetyCar;
    // Cars: create models as they appear, drop the ones that left.
    const seen = new Set<string>();
    for (const car of [own, ...others]) {
      seen.add(car.id);
      const key = `${car.livery.body}|${car.livery.wings}|${car.ghost ?? ''}|${car.ghostOpacity ?? ''}|${car === own}`;
      let entry = this.cars.get(car.id);
      if (entry && entry.key !== key) {
        entry.model.group.removeFromParent();
        entry.model.dispose();
        entry = undefined;
      }
      if (!entry) {
        const model = new CarModel(car.livery, { ghost: car.ghost, opacity: car.ghostOpacity });
        if (car === own) {
          model.addSteeringWheel();
          model.addMirrorGlass(this.mirrorTarget.texture);
          this.near.add(model.group);
        } else this.scene.add(model.group);
        entry = { model, key };
        this.cars.set(car.id, entry);
      }
      // In the pits: new tyres show once fitted, and other cars rise on their jacks (not our
      // own, so the cockpit never moves round the camera).
      entry.model.update(car.x, car.y, car.heading, car.steer, car.drsOpen, pit?.fitted.get(car.id) ?? car.compound);
      entry.model.group.position.y = this.heightAt(car.x, car.y, car.trackIndex) + (car === own ? 0 : (pit?.lift.get(car.id) ?? 0) * 0.09);
      // Our own car pitches exactly as the camera does, so the cockpit never shakes in view.
      entry.model.group.rotation.z = car === own ? this.pitch : Math.atan(this.uphill(car));
    }
    for (const [id, entry] of this.cars) {
      if (seen.has(id)) continue;
      entry.model.group.removeFromParent();
      entry.model.dispose();
      this.cars.delete(id);
    }
    const mine = this.cars.get(own.id)!.model;
    const def = CAMS[this.mode];
    mine.driverVisible = !def.inside || this.lookBack;
    mine.haloVisible = !def.noHalo;
    mine.wheel?.show(own.wheel);
    mine.mirrorsVisible = this.mirror;

    this.placeCamera(own, dt);
    if (items) {
      if (!this.items) {
        this.items = new Items3d(this.track, (x, y, i) => this.heightAt(x, y, i ?? null));
        this.scene.add(this.items.group);
      }
      this.items.update(items, this.camera, dt, (id) => this.cars.get(id)?.model, own.id);
      // Knocked out: the camera shakes.
      const shake = this.items.shake(own.id);
      if (shake > 0) this.camera.position.add(new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(shake * 0.5));
    }
    if (this.items) this.items.group.visible = !!items;
    if (pit && this.track.pit) {
      if (!this.pit) {
        this.pit = new Pit3d((x, y) => this.heightAt(x, y, null));
        this.scene.add(this.pit.group);
      }
      this.pit.update(pit, dt);
    }
    if (this.pit) this.pit.group.visible = !!pit;

    // The mirror (every other frame), while the sky sits round the mirror camera.
    if (this.mirror && this.mirrorFrame++ % 2 === 0) {
      const cos = Math.cos(own.heading);
      const sin = Math.sin(own.heading);
      const lift = this.heightAt(own.x, own.y, own.trackIndex);
      this.mirrorCamera.position.set(own.x + cos * EYE[0], 1.0 + lift, own.y + sin * EYE[0]);
      this.mirrorCamera.lookAt(own.x - cos * 40, 0.4 + lift, own.y - sin * 40);
      this.sky.position.copy(this.mirrorCamera.position);
      this.renderer.setRenderTarget(this.mirrorTarget);
      this.renderer.clear();
      this.renderer.render(this.scene, this.mirrorCamera);
      this.renderer.setRenderTarget(null);
    }

    this.sky.position.copy(this.camera.position);

    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    this.renderer.clearDepth();
    this.nearCamera.position.copy(this.camera.position);
    this.nearCamera.quaternion.copy(this.camera.quaternion);
    this.nearCamera.fov = this.camera.fov;
    this.nearCamera.updateProjectionMatrix();
    this.renderer.render(this.near, this.nearCamera);

    // Outside the cockpit the car's own mirrors can't be seen: show one at the top of the screen.
    if (this.mirror && !def.inside && !this.lookBack) this.drawScreenMirror();
  }

  private drawScreenMirror(): void {
    const w = Math.min(420, this.width * 0.4);
    const h = w / 4;
    const x = (this.width - w) / 2;
    const top = 10;
    const size = this.renderer.getSize(new THREE.Vector2());
    // Viewports count from the bottom of the canvas.
    const y = size.y - top - h;
    this.renderer.clearDepth();
    this.screenGlass.visible = false;
    this.screenFrame.visible = true;
    this.renderer.setViewport(x - 3, y - 3, w + 6, h + 6);
    this.renderer.render(this.screenMirror, this.screenCamera);
    this.screenFrame.visible = false;
    this.screenGlass.visible = true;
    this.renderer.setViewport(x, y, w, h);
    this.renderer.render(this.screenMirror, this.screenCamera);
    this.renderer.setViewport(0, 0, size.x, size.y);
  }

  private placeCamera(own: OwnCarView, dt: number): void {
    const lift = this.heightAt(own.x, own.y, own.trackIndex);
    const cam = this.lookBack ? LOOK_BACK : CAMS[this.mode];
    let heading = own.heading;
    if (cam.chase) {
      // The chase camera swings round behind the car a little late.
      if (this.chaseHeading === null) this.chaseHeading = heading;
      const diff = Math.atan2(Math.sin(heading - this.chaseHeading), Math.cos(heading - this.chaseHeading));
      this.chaseHeading += diff * Math.min(1, dt * 6);
      heading = this.chaseHeading;
    } else this.chaseHeading = null;
    // Look slightly into the corner.
    const target = Math.max(-0.12, Math.min(0.12, own.yawRate * 0.1));
    this.look += (target - this.look) * Math.min(1, dt * 4);
    // Onboard cameras pitch with the car; chase cameras stay level.
    const pitch = cam.chase ? 0 : this.pitch;
    const pc = Math.cos(pitch);
    const ps = Math.sin(pitch);
    const toWorld = (q: [number, number, number], yaw = 0): THREE.Vector3 => {
      const p: [number, number, number] = [q[0] * pc - q[1] * ps, q[0] * ps + q[1] * pc, q[2]];
      const h = heading + yaw;
      const cos = Math.cos(h);
      const sin = Math.sin(h);
      return new THREE.Vector3(own.x + p[0] * cos - p[2] * sin, p[1] + lift, own.y + p[0] * sin + p[2] * cos);
    };
    // The chase camera is placed from the smoothed heading but stays centred on the car.
    const eye = toWorld(cam.eye);
    if (cam.chase) {
      const d = Math.hypot(cam.eye[0], cam.eye[2]);
      eye.set(own.x - Math.cos(heading) * d, cam.eye[1] + lift, own.y - Math.sin(heading) * d);
    }
    this.camera.position.copy(eye);
    this.camera.lookAt(toWorld(cam.look, cam.chase ? 0 : this.look));
    this.camera.fov = cam.fov + FOV_SPEED * Math.min(1, own.speed / 90);
    this.camera.updateProjectionMatrix();
  }

  /** Rise per metre along a car's nose, from the slope of the road where it is. */
  private uphill(car: CarView): number {
    if (!this.track.hilly) return 0;
    const r = this.track.roadHeight(car.x, car.y, car.trackIndex ?? null);
    return r ? r.grade * (Math.cos(car.heading) * r.tx + Math.sin(car.heading) * r.ty) : 0;
  }

  /** Height of the road under a point, blended between samples like the road mesh (0 on a flat track). */
  heightAt(x: number, y: number, trackIndex: number | null = null): number {
    if (!this.track.hilly) return 0;
    return this.track.roadHeight(x, y, trackIndex)?.z ?? 0;
  }

  dispose(): void {
    for (const { model } of this.cars.values()) model.dispose();
    this.safetyCar?.dispose();
    this.items?.dispose();
    this.pit?.dispose();
    this.cars.clear();
    for (const d of this.disposables) d.dispose();
    this.renderer.dispose();
    this.canvas.remove();
  }
}

/** Hills on the horizon, to go with the land and the sky. */
function hillColor(def: SceneryDef | null): string {
  if (def?.sky === 'night') return '#1a2233';
  if (def?.land === 'desert') return '#b49a72';
  if (def?.land === 'dunes') return '#a8a37c';
  if (def?.alps) return '#6c7d78';
  return '#62806c';
}
