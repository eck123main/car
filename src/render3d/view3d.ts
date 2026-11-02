import * as THREE from 'three';
import type { Livery } from '../render/livery';
import type { Compound } from '../sim/tyres';
import type { Track } from '../track/track';
import { brakeHeat, CarModel, EYE, mirrorUv, SafetyCarModel, type WheelInfo } from './carModel';
import { Items3d, type ItemsFrame } from './items3d';
import { Debris3d } from './debris3d';
import type { Debris } from '../sim/debris';
import type { CarParts } from '../physics/car';
import { Pit3d } from './pit3d';
import { IdealLine3d } from './idealLine3d';
import type { IdealLine } from '../sim/ai/idealLine';
import type { PitScene } from '../render/pitStops';
import { Scenery3d } from './scenery3d';
import { Landmarks, lookOf, waterOf } from './landmarks';
import { Terrain } from './terrain';
import { HeadMotion, type Feel, type HeadPose } from './feel';
import { Sparks3d, type SparkCar } from './sparks3d';
import { Rain3d, Visor, type SprayCar } from './rain3d';
import { TyreFx3d, type TyreCar } from './tyreFx3d';
import { Marshals3d, type TrackFlag } from './marshals3d';
import { Celebration3d, podiumCamera, podiumSpots, type PodiumSpot } from './celebration3d';
import { CarLights3d, type LitCar } from './carLights3d';
import { Clouds3d, Marbles3d, sunsetShare } from './trackLife3d';
import { Flyover3d, GridCrew3d } from './raceDay3d';
import type { Shot } from './tvCamera';
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
  /** Parts knocked off (Car.lost bits). */
  lost?: number;
  /** Damage per part (Car.parts), shown on the body. */
  parts?: CarParts;
  /** m/s and brake (0-1), for glowing brake discs and sparks. */
  speed?: number;
  brake?: number;
  /** Throttle (0-1) and direction of travel against the nose (rad), for tyre smoke. */
  throttle?: number;
  slip?: number;
  /** Stands this far above the road (m): the podium steps. */
  lift?: number;
  /** Tyre wear (0-1) and how unsettled the car is after a hit (Car.upset), for looks. */
  wear?: number;
  upset?: number;
  /** Lobby colour, for the grid crew's shirts. */
  color?: string;
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
  /** What the driver feels (g-forces, kerbs, hits); a hit also makes them catch the slide. */
  feel?: Feel;
  /** The camera moves with the driver's head and the wheel vibrates (off: everything steady). */
  headMoves?: boolean;
}

/** What the race looks like around the cars (see View3D.setRace). */
export interface RaceLook {
  /** Red start lights showing (0-5). */
  lights: number;
  /** Track wetness (0-1): rain, spray, grey skies. */
  wetness?: number;
  /** Flags the marshals wave round the lap. */
  flag?: TrackFlag;
  /** The chequered flag is out at the line. */
  chequered?: boolean;
  /** The session's phase: the grid crew and the fly-over go by it. */
  phase?: string;
  /** How far through the race the leader is (0-1): the light, the rubber. */
  progress?: number;
}

const RAIN_GREY = new THREE.Color('#7f868f');
/** The end of a long race on a clear day: a low, warm sun. */
const SUNSET_SUN = new THREE.Color('#ffb070');
const SUNSET_FOG = new THREE.Color('#f2cdaa');
const SUNSET_SKY = new THREE.Color('#ffd5b0');
/** World direction the low sun throws shadows (rad), and how far (m) at the end of a race. */
const SHADOW_ANGLE = 0.6;
const SHADOW_REACH = 1.6;

/** A jump in Car.upset this big is a hit worth showing. */
const HIT_LOOK = 0.05;

const STILL_HEAD: HeadPose = { x: 0, y: 0, z: 0, roll: 0, pitch: 0, shake: 0 };

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
  private readonly cars = new Map<string, { model: CarModel; key: string; heat: number; upset: number }>();
  private readonly disposables: { dispose(): void }[] = [];
  private chaseHeading: number | null = null;
  private readonly headMotion = new HeadMotion();
  private headPose: HeadPose = STILL_HEAD;
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
  private debris: Debris3d | null = null;
  /** Pit boxes and crews, made the first time a frame has them. */
  private pit: Pit3d | null = null;
  /** The ideal line driving aid, made the first time it is switched on. */
  private ideal: IdealLine3d | null = null;
  private time = 0;
  private width = 1;
  private readonly track: Track;
  private readonly scenery: Scenery3d;
  private readonly sparks = new Sparks3d();
  private readonly tyreFx = new TyreFx3d();
  /** A camera that isn't on the car (podium, TV): our car is then drawn like any other. */
  private cinema: Shot | null = null;
  private celebration: Celebration3d | null = null;
  private readonly marshals: Marshals3d;
  private readonly lights = new CarLights3d();
  private readonly sky3d: 'day' | 'dusk' | 'night';
  private readonly clouds: Clouds3d;
  private readonly marbles: Marbles3d;
  private gridCrew: GridCrew3d | null = null;
  private flyover: Flyover3d | null = null;
  private phase = '';
  private crewPlaced = false;
  /** How far the sun has sunk (0-1), and what is showing. */
  private sunset = 0;
  private shownSunset = -1;
  private readonly suns: THREE.DirectionalLight[] = [];
  private readonly sunColor: THREE.Color;
  private trackFlag: TrackFlag = null;
  private chequered = false;
  private readonly rain = new Rain3d();
  private readonly visor = new Visor();
  private readonly visorScene = new THREE.Scene();
  /** Track wetness (0-1) and what the dry look was, to grey it over in the rain. */
  private wetness = 0;
  private shownWet = -1;
  private drying = false;
  private readonly dry: { fog: THREE.Color; near: number; far: number; lights: [THREE.Light, number][] };
  private readonly skyMat: THREE.MeshBasicMaterial;
  private readonly groundMat: THREE.MeshLambertMaterial;

  constructor(track: Track) {
    this.canvas = document.createElement('canvas');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.autoClear = false;
    // Each circuit's own look: night races, sunsets, desert, mountains.
    const look = lookOf(track.scenery);
    this.track = track;
    this.renderer.setClearColor(look.skyHorizon);
    this.scene.fog = new THREE.Fog(look.skyHorizon, look.fogNear, look.fogFar);
    const lights: [THREE.Light, number][] = [];
    this.sunColor = new THREE.Color(look.sunColor);

    for (const scene of [this.scene, this.near]) {
      const hemi = new THREE.HemisphereLight(look.night ? '#9fb4ff' : '#e8f1ff', '#4a5a3a', look.ambient);
      const sun = new THREE.DirectionalLight(look.sunColor, look.sun);
      sun.position.set(0.5, 1, 0.3);
      this.suns.push(sun);
      scene.add(hemi, sun);
      lights.push([hemi, look.ambient], [sun, look.sun]);
    }

    const noise = noiseTexture();
    const ground = new THREE.MeshLambertMaterial({ vertexColors: true, map: noise, side: THREE.DoubleSide });
    this.groundMat = ground;
    this.dry = { fog: new THREE.Color(look.skyHorizon), near: look.fogNear, far: look.fogFar, lights };
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
    const scenery = (this.scenery = new Scenery3d(track, solid, {
      trees: look.trees,
      blocked: (x, y, margin) => landmarks.blocked(x, y, margin),
      hills: hillColor(track.scenery),
      alps: track.scenery?.alps,
      heightAt: (x, y) => this.heightAt(x, y),
      groundAt: (x, y) => terrain.heightAt(x, y),
      base: terrain.base,
    }));
    this.marshals = new Marshals3d(track, {
      blocked: (x, y, margin) => landmarks.blocked(x, y, margin),
      heightAt: (x, y) => this.heightAt(x, y),
      groundAt: (x, y) => terrain.heightAt(x, y),
    });
    this.sky3d = track.scenery?.sky === 'night' ? 'night' : track.scenery?.sky === 'dusk' ? 'dusk' : 'day';
    this.clouds = new Clouds3d(this.sky3d);
    this.marbles = new Marbles3d(track, (x, y) => this.heightAt(x, y));
    this.disposables.push(scenery, this.sparks, this.tyreFx, this.marshals, this.lights, this.rain, this.visor, this.clouds, this.marbles);
    this.scene.add(this.sparks.mesh, this.tyreFx.group, this.marshals.group, this.lights.group, this.rain.group, this.clouds.mesh, this.marbles.mesh);
    this.near.add(this.lights.nearGroup);
    // Rain on the visor: a see-through picture over the whole screen (cockpit cameras).
    const visorQuad = new THREE.PlaneGeometry(2, 2);
    const visorMat = new THREE.MeshBasicMaterial({ map: this.visor.texture, transparent: true, depthTest: false, depthWrite: false });
    this.visorScene.add(new THREE.Mesh(visorQuad, visorMat));
    this.disposables.push(visorQuad, visorMat);
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
    this.skyMat = skyMat;
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

  /** Parts knocked off cars, lying on the track (call before render). */
  showDebris(debris: readonly Debris[], liveryOf: (owner: string) => Livery, time: number, dt: number): void {
    if (!this.debris) {
      if (debris.length === 0) return;
      this.debris = new Debris3d((x, y, i) => this.heightAt(x, y, i));
      this.scene.add(this.debris.group);
    }
    this.debris.update(debris, liveryOf, time, dt);
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
      const onboard = car === own && !this.cinema;
      const key = `${car.livery.body}|${car.livery.wings}|${car.ghost ?? ''}|${car.ghostOpacity ?? ''}|${onboard}`;
      let entry = this.cars.get(car.id);
      if (entry && entry.key !== key) {
        entry.model.group.removeFromParent();
        entry.model.dispose();
        entry = undefined;
      }
      if (!entry) {
        const model = new CarModel(car.livery, { ghost: car.ghost, opacity: car.ghostOpacity });
        if (onboard) {
          model.addSteeringWheel();
          model.addMirrorGlass(this.mirrorTarget.texture);
          this.near.add(model.group);
        } else this.scene.add(model.group);
        entry = { model, key, heat: 0, upset: car.upset ?? 0 };
        this.cars.set(car.id, entry);
      }
      // In the pits: new tyres show once fitted, and other cars rise on their jacks (not our
      // own, so the cockpit never moves round the camera).
      entry.model.update(car.x, car.y, car.heading, car.steer, car.drsOpen, pit?.fitted.get(car.id) ?? car.compound);
      entry.model.setLost(car.lost ?? 0);
      if (car.parts) entry.model.setDamage(car.parts);
      entry.heat = brakeHeat(entry.heat, car.brake ?? 0, car.speed ?? 0, dt);
      entry.model.setBrakeHeat(entry.heat);
      if (car.wear !== undefined) entry.model.setWear(car.wear);
      // A hit: sparks and carbon dust (from the jump in upset, so clients see them too).
      const upset = car.upset ?? 0;
      if (upset - entry.upset > HIT_LOOK && !car.ghost) {
        const ground = this.heightAt(car.x, car.y, car.trackIndex);
        const v = car.speed ?? 0;
        const vx = Math.cos(car.heading) * v;
        const vy = Math.sin(car.heading) * v;
        this.sparks.burst(car.x, car.y, ground, vx, vy, Math.min(70, 16 + Math.round((upset - entry.upset) * 80)));
        this.tyreFx.hit(car.x, car.y, ground, vx, vy, 6);
      }
      entry.upset = upset;
      entry.model.group.position.y = this.heightAt(car.x, car.y, car.trackIndex) + (car === own ? 0 : (pit?.lift.get(car.id) ?? 0) * 0.09) + (car.lift ?? 0);
      // Our own car pitches exactly as the camera does, so the cockpit never shakes in view.
      entry.model.group.rotation.z = car === own ? this.pitch : Math.atan(this.uphill(car));
      if (this.sunset > 0.02) entry.model.setShadow(this.sunset * SHADOW_REACH, SHADOW_ANGLE);
    }
    this.updateSparks([own, ...others], dt);
    for (const [id, entry] of this.cars) {
      if (seen.has(id)) continue;
      entry.model.group.removeFromParent();
      entry.model.dispose();
      this.cars.delete(id);
    }
    const mine = this.cars.get(own.id)!.model;
    const def = this.cinema ? CAMS.chase : CAMS[this.mode];
    mine.driverVisible = !def.inside || this.lookBack;
    mine.haloVisible = !def.noHalo;
    // Head movement, camera shake and the wheel's vibration are one setting, off by default.
    const head = own.feel && own.headMoves ? this.headMotion.step(own.feel, dt) : STILL_HEAD;
    this.headPose = head;
    mine.wheel?.drive(own.steer, own.speed, own.yawRate, own.wheel, dt, head.shake, own.slip ?? 0, own.feel?.upset ?? 0);
    mine.wheel?.show(own.wheel);
    mine.mirrorsVisible = this.mirror;
    const mirror = this.mirror && !this.cinema;

    this.placeCamera(own, dt);
    this.updateRain(own, [own, ...others], def.inside === true && !this.lookBack, dt);
    this.updateTyreFx([own, ...others], dt);
    this.marshals.update(this.trackFlag, this.chequered, this.time);
    this.updateLights(own, others);
    this.celebration?.update(dt, this.pixelScale());
    this.updateLife(own, others, dt);
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
    if (mirror && this.mirrorFrame++ % 2 === 0) {
      const cos = Math.cos(own.heading);
      const sin = Math.sin(own.heading);
      const lift = this.heightAt(own.x, own.y, own.trackIndex);
      this.mirrorCamera.position.set(own.x + cos * EYE[0], 1.0 + lift, own.y + sin * EYE[0]);
      this.mirrorCamera.lookAt(own.x - cos * 40, 0.4 + lift, own.y - sin * 40);
      this.sky.position.copy(this.mirrorCamera.position);
      this.renderer.setRenderTarget(this.mirrorTarget);
      this.renderer.clear();
      // Particles are sized for the main camera, and your own smoke would fill the glass.
      this.tyreFx.showParticles(false);
      // Nobody would see these in a mirror this small: two draw calls saved.
      const marbles = this.marbles.mesh.visible;
      this.clouds.mesh.visible = this.marbles.mesh.visible = false;
      this.renderer.render(this.scene, this.mirrorCamera);
      this.clouds.mesh.visible = true;
      this.marbles.mesh.visible = marbles;
      this.tyreFx.showParticles(true);
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

    if (def.inside && !this.lookBack && this.visor.visible) {
      this.renderer.clearDepth();
      this.renderer.render(this.visorScene, this.screenCamera);
    }
    // Outside the cockpit the car's own mirrors can't be seen: show one at the top of the screen.
    if (mirror && !def.inside && !this.lookBack) this.drawScreenMirror();
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
    if (this.cinema) {
      const { eye, look, fov } = this.cinema;
      this.camera.position.set(...eye);
      this.camera.lookAt(...look);
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
      return;
    }
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
    // The driver's head moves with the g-forces and shakes; cameras bolted to the car only shake.
    const hp = this.headPose;
    const head = cam.inside && !this.lookBack;
    const off: [number, number, number] = head ? [hp.x, hp.y, hp.z] : [0, hp.y * (cam.chase ? 0.4 : 1), 0];
    const add = (q: [number, number, number], up = 0): [number, number, number] => [q[0] + off[0], q[1] + off[1] + up, q[2] + off[2]];
    // The chase camera is placed from the smoothed heading but stays centred on the car.
    const eye = toWorld(add(cam.eye));
    if (cam.chase) {
      const d = Math.hypot(cam.eye[0], cam.eye[2]);
      eye.set(own.x - Math.cos(heading) * d, cam.eye[1] + off[1] + lift, own.y - Math.sin(heading) * d);
    }
    this.camera.position.copy(eye);
    this.camera.lookAt(toWorld(add(cam.look, head ? hp.pitch * 30 : 0), cam.chase ? 0 : this.look));
    if (head) this.camera.rotateZ(hp.roll);
    this.camera.fov = cam.fov + FOV_SPEED * Math.min(1, own.speed / 90);
    this.camera.updateProjectionMatrix();
  }

  /** Rain round the camera, spray behind the cars, drops on the visor. */
  private updateRain(own: OwnCarView, cars: CarView[], visor: boolean, dt: number): void {
    const spray = new Map<string, SprayCar>();
    if (this.wetness > 0.15) {
      for (const car of cars) {
        if (car.ghost || !car.speed) continue;
        spray.set(car.id, { x: car.x, y: car.y, heading: car.heading, speed: car.speed, ground: this.heightAt(car.x, car.y, car.trackIndex) });
      }
    }
    const vel = new THREE.Vector3(Math.cos(own.heading) * own.speed, 0, Math.sin(own.heading) * own.speed);
    const rain = this.drying ? 0 : this.wetness;
    this.rain.update(rain, this.wetness, this.camera.position, vel, spray, dt);
    this.visor.update(visor ? rain : 0, own.speed, dt);
  }

  /** Clouds, grid crew and the fly-over: a few numbers a frame unless something is showing. */
  private updateLife(own: CarView, others: CarView[], dt: number): void {
    const scale = this.pixelScale();
    this.clouds.update(this.camera.position, this.wetness, dt);
    this.flyover?.update(dt, scale);
    if (this.phase === 'grid' && !this.crewPlaced) {
      this.crewPlaced = true;
      if (!this.gridCrew) {
        this.gridCrew = new GridCrew3d();
        this.scene.add(this.gridCrew.group);
        this.disposables.push(this.gridCrew);
      }
      this.gridCrew.place([own, ...others].filter((c) => !c.ghost).map((c) => ({ x: c.x, y: c.y, heading: c.heading, ground: this.heightAt(c.x, c.y, c.trackIndex), color: c.color ?? c.livery.body })));
    }
    if (this.phase !== 'grid' && this.phase !== 'lights' && this.phase !== 'race') this.gridCrew?.hide();
    this.gridCrew?.update(this.phase !== 'grid', this.wetness > 0.15, dt);
  }

  /** A TV camera (replays, the fly-around) instead of the ones on the car; null goes back to those. */
  setShot(shot: Shot | null): void {
    if (!shot && this.cinema) this.snap();
    this.cinema = shot;
  }

  /** Beams, tail lights and their reflections, for the real cars. */
  private updateLights(own: CarView, others: CarView[]): void {
    // Bright dry day: nothing to do (no list, no matrices).
    if (this.sky3d === 'day' && this.wetness === 0) {
      this.lights.update([], null, 'day', 0, this.time);
      return;
    }
    const lit = (c: CarView): LitCar => ({ x: c.x, y: c.y, heading: c.heading, ground: this.heightAt(c.x, c.y, c.trackIndex) });
    const mine = lit(own);
    this.lights.update([mine, ...others.filter((c) => !c.ghost).map(lit)], mine, this.sky3d, this.wetness, this.time);
  }

  /** Smoke, rubber, dust and stones from every real car. */
  private updateTyreFx(cars: CarView[], dt: number): void {
    const list = new Map<string, TyreCar>();
    const cos = (c: CarView) => Math.cos(c.heading);
    const sin = (c: CarView) => Math.sin(c.heading);
    for (const car of cars) {
      if (car.ghost || car.speed === undefined) continue;
      // Only look the surface up when a car is moving: parked cars never kick up dust.
      const front = car.speed > 5 ? this.track.surfaceAt(car.x + cos(car) * 1.75, car.y + sin(car) * 1.75, car.trackIndex ?? null).type : 'asphalt';
      const rear = car.speed > 5 ? this.track.surfaceAt(car.x - cos(car) * 1.45, car.y - sin(car) * 1.45, car.trackIndex ?? null).type : 'asphalt';
      list.set(car.id, {
        x: car.x,
        y: car.y,
        heading: car.heading,
        speed: car.speed,
        brake: car.brake ?? 0,
        throttle: car.throttle ?? 0,
        slip: car.slip ?? 0,
        ground: this.heightAt(car.x, car.y, car.trackIndex),
        front,
        rear,
      });
    }
    this.tyreFx.update(list, this.wetness, this.camera.position, dt, this.pixelScale());
  }

  /** Pixels per metre, one metre from the camera (for sized particles). */
  private pixelScale(): number {
    const h = this.renderer.getDrawingBufferSize(new THREE.Vector2()).y;
    return h / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2));
  }

  /** Sparks from the floors of cars pressed down hard (not ghosts). */
  private updateSparks(cars: CarView[], dt: number): void {
    const list = new Map<string, SparkCar>();
    for (const car of cars) {
      if (car.ghost || !car.speed) continue;
      const slope = this.track.slope(car.trackIndex ?? null);
      // As Car.step: the road's vertical curve makes the car heavier in a dip.
      const weight = slope ? Math.max(0.3, Math.min(1.8, 1 + (car.speed * car.speed * slope.vcurv) / 9.81)) : 1;
      list.set(car.id, { x: car.x, y: car.y, heading: car.heading, speed: car.speed, weight, ground: this.heightAt(car.x, car.y, car.trackIndex) });
    }
    this.sparks.update(list, dt);
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

  /** Race state the scenery shows: start lights lit (0-5) on the gantry. */
  setRace(race: RaceLook): void {
    this.scenery.setStartLights(race.lights);
    this.trackFlag = race.flag ?? null;
    this.chequered = !!race.chequered;
    const phase = race.phase ?? '';
    if (phase !== this.phase) {
      if (phase === 'grid') this.crewPlaced = false;
      // Lights out: the fly-over.
      if (phase === 'race' && this.phase === 'lights') {
        if (!this.flyover) {
          this.flyover = new Flyover3d();
          this.scene.add(this.flyover.group);
          this.disposables.push(this.flyover);
        }
        const s = this.track.samples[0];
        this.flyover.fly(s.x, s.y, s.tx, s.ty, this.heightAt(s.x, s.y));
      }
      this.phase = phase;
    }
    const progress = race.progress ?? 0;
    this.marbles.setAmount(progress);
    this.sunset = sunsetShare(this.sky3d, progress);
    const wet = race.wetness ?? 0;
    // A track drying out means the rain has stopped (it rains while it is wet or getting wetter).
    if (wet < this.wetness - 1e-6) this.drying = true;
    else if (wet > this.wetness + 1e-6 || wet === 0) this.drying = false;
    this.wetness = wet;
    const w = Math.round(this.wetness * 50) / 50;
    const dusk = Math.round(this.sunset * 40) / 40;
    if (w === this.shownWet && dusk === this.shownSunset) return;
    this.shownWet = w;
    this.shownSunset = dusk;
    // Wet: a grey sky, mist closing in, duller light, a darker road.
    const fog = this.scene.fog as THREE.Fog;
    // (And the low sun of a long race, warming everything, under any rain.)
    fog.color.copy(this.dry.fog).lerp(SUNSET_FOG, dusk * 0.45).lerp(RAIN_GREY, w * 0.9);
    fog.near = this.dry.near * (1 - 0.55 * w);
    fog.far = this.dry.far * (1 - 0.5 * w);
    this.renderer.setClearColor(fog.color);
    this.skyMat.color.setScalar(1).lerp(SUNSET_SKY, dusk * 0.6).lerp(RAIN_GREY, w * 0.85);
    for (const [light, base] of this.dry.lights) light.intensity = base * (1 - 0.35 * w) * (1 - 0.18 * dusk);
    for (const sun of this.suns) {
      sun.color.copy(this.sunColor).lerp(SUNSET_SUN, dusk * 0.85);
      sun.position.set(0.5 + dusk * 0.5, 1 - dusk * 0.62, 0.3 + dusk * 0.3);
    }
    this.groundMat.color.setScalar(1 - 0.22 * w);
  }

  /** A new race: clean road. */
  clearRubber(): void {
    this.tyreFx.clearMarks();
  }

  /** Where the top three stand at the end of a race. */
  podiumPlaces(): PodiumSpot[] {
    return podiumSpots(this.track);
  }

  /** Steps, confetti and fireworks; colours: the drivers on the podium. */
  showPodium(colors: readonly string[]): void {
    if (!this.celebration) {
      this.celebration = new Celebration3d(this.sky3d !== 'day');
      this.scene.add(this.celebration.group);
      this.disposables.push(this.celebration);
    }
    const spots = this.podiumPlaces();
    this.celebration.show(spots, spots.map((s) => this.heightAt(s.x, s.y)), colors);
  }

  /** The camera t seconds into the podium. */
  aimPodium(t: number): void {
    const c = this.podiumPlaces()[0];
    this.cinema = podiumCamera(c, this.heightAt(c.x, c.y), t);
  }

  /** Back to the normal cameras. */
  endPodium(): void {
    this.cinema = null;
    this.celebration?.hide();
    this.snap();
  }

  /** Show the ideal line on the road (null hides it). */
  showIdealLine(ideal: IdealLine | null): void {
    if (ideal && !this.ideal) {
      this.ideal = new IdealLine3d(this.track, ideal);
      this.scene.add(this.ideal.mesh);
    }
    if (this.ideal) this.ideal.mesh.visible = !!ideal;
  }

  dispose(): void {
    this.ideal?.dispose();
    for (const { model } of this.cars.values()) model.dispose();
    this.safetyCar?.dispose();
    this.items?.dispose();
    this.debris?.dispose();
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
