import * as THREE from 'three';
import type { CarParts } from '../../physics/car';
import type { Livery } from '../../render/livery';
import type { SurfaceType } from '../../track/types';
import { type Biome, type TimeOfDay } from '../../sim/openRoad/biomes';
import type { Land } from '../../sim/openRoad/land';
import type { CarClassId } from '../../sim/carClass';
import { brakeHeat, CarModel, mirrorUv, type Car3d, type WheelInfo } from '../carModel';
import { Gt3Model } from '../gt3Model';
import { LmhModel } from '../lmhModel';
import { noiseTexture } from '../trackMesh';
import { TyreFx3d, type TyreCar } from '../tyreFx3d';
import { CAM3D_NAMES, CAM3D_ORDER, camsFor, lookBackFor, type Cam3d, EYE_POINT } from '../view3d';
import { Motes, Sky, SKIES, Water, type SkyLook } from './atmosphere';
import { Flora } from './flora';
import { RoadMeshes } from './roadMesh';
import { TerrainTiles } from './terrainTiles';

export { CAM3D_NAMES, CAM3D_ORDER, type Cam3d };

/** Everything the view needs about our car, each frame. */
export interface RoadCarView {
  x: number;
  y: number;
  z: number;
  /** Rise per metre along the nose. */
  uphill: number;
  heading: number;
  steer: number;
  speed: number;
  yawRate: number;
  brake: number;
  throttle: number;
  slip: number;
  drsOpen: boolean;
  roadIndex: number;
  front: SurfaceType;
  rear: SurfaceType;
  livery: Livery;
  wheel: WheelInfo;
  parts: CarParts;
  lost: number;
}

const MAX_PIXEL_RATIO = 1.25;
const FOV_SPEED = 8;
const MIRROR_SIZE = [512, 128] as const;
const MIRROR_FOV = 20;
const MIRROR_FAR = 900;
/** How fast the light changes to a new time of day or landscape (1/s). */
const LOOK_RATE = 0.7;

/** Mixed-together numbers for the light and sky. */
interface Look {
  sunHeight: number;
  sunAngle: number;
  sun: THREE.Color;
  sunPower: number;
  ambient: number;
  ambientTop: THREE.Color;
  ambientGround: THREE.Color;
  top: THREE.Color;
  horizon: THREE.Color;
  glow: THREE.Color;
  clouds: THREE.Color;
  cloudShade: THREE.Color;
  cover: number;
  haze: number;
  waterShallow: THREE.Color;
  waterDeep: THREE.Color;
}

const COLOR_KEYS = ['sun', 'ambientTop', 'ambientGround', 'top', 'horizon', 'glow', 'clouds', 'cloudShade', 'waterShallow', 'waterDeep'] as const;
const NUMBER_KEYS = ['sunHeight', 'sunAngle', 'sunPower', 'ambient', 'cover', 'haze'] as const;

function newLook(): Look {
  const c = () => new THREE.Color();
  return { sunHeight: 1, sunAngle: 0, sun: c(), sunPower: 1, ambient: 1, ambientTop: c(), ambientGround: c(), top: c(), horizon: c(), glow: c(), clouds: c(), cloudShade: c(), cover: 0.4, haze: 0.0001, waterShallow: c(), waterDeep: c() };
}

/** A landscape's sky at a time of day. */
function lookFor(b: Biome, sky: SkyLook, out: Look): void {
  out.sunHeight = sky.sunHeight;
  out.sunAngle = sky.sunAngle;
  out.sunPower = sky.sunPower;
  out.ambient = sky.ambient;
  out.sun.set(sky.sun);
  out.ambientTop.set(sky.ambientTop);
  out.ambientGround.set(sky.ambientGround);
  const tint = new THREE.Color(b.air.tint);
  const share = b.air.tintShare;
  out.top.set(sky.top).lerp(tint, share * 0.5);
  out.horizon.set(sky.horizon).lerp(tint, share);
  out.glow.set(sky.glow);
  out.clouds.set(sky.clouds);
  out.cloudShade.set(sky.cloudShade);
  out.cover = b.air.clouds;
  out.haze = b.air.haze;
  out.waterShallow.set(b.colors.water);
  out.waterDeep.set(b.colors.waterDeep);
}

/**
 * The open road in 3D: land, road, plants and sky made as they come into view, and the same car
 * model as the race. Only a renderer: OpenRoadDrive and the real car physics do the driving.
 */
export class OpenRoadView {
  readonly canvas: HTMLCanvasElement;
  mode: Cam3d = 'cockpit';
  mirror = true;
  lookBack = false;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly near = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(60, 1, 1, 26000);
  private readonly nearCamera = new THREE.PerspectiveCamera(60, 1, 0.02, 40);
  private readonly fog = new THREE.FogExp2('#ffffff', 0.0001);
  private readonly terrain: TerrainTiles;
  private readonly roadMeshes: RoadMeshes;
  private readonly flora: Flora;
  private readonly sky = new Sky();
  private readonly water = new Water();
  private readonly motes = new Motes();
  private readonly tyreFx = new TyreFx3d();
  private readonly disposables: { dispose(): void }[] = [];
  private readonly hemis: THREE.HemisphereLight[] = [];
  private readonly suns: THREE.DirectionalLight[] = [];
  private readonly current = newLook();
  private readonly goal = newLook();
  private readonly goalB = newLook();
  private time: TimeOfDay;
  private timeOverride = false;
  private readonly sunDir = new THREE.Vector3(0, 1, 0);
  private model: Car3d | null = null;
  private liveryKey = '';
  private readonly mirrorTarget = new THREE.WebGLRenderTarget(MIRROR_SIZE[0], MIRROR_SIZE[1]);
  private readonly mirrorCamera = new THREE.PerspectiveCamera(MIRROR_FOV, MIRROR_SIZE[0] / MIRROR_SIZE[1], 1, MIRROR_FAR);
  private readonly screenMirror = new THREE.Scene();
  private readonly screenCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly screenFrame: THREE.Mesh;
  private readonly screenGlass: THREE.Mesh;
  private mirrorFrame = 0;
  private width = 1;
  private clock = 0;
  private chaseHeading: number | null = null;
  private lookInto = 0;
  private pitch = 0;
  private heat = 0;
  private moteBiome = '';
  private snapLook = true;

  constructor(
    private readonly land: Land,
    private readonly body: CarClassId = 'f1',
  ) {
    this.canvas = document.createElement('canvas');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.autoClear = false;
    this.renderer.info.autoReset = false;
    this.time = land.map.biomes[0].time;
    this.scene.fog = this.fog;

    for (const scene of [this.scene, this.near]) {
      const hemi = new THREE.HemisphereLight('#ffffff', '#555555', 1);
      const sun = new THREE.DirectionalLight('#ffffff', 2);
      this.hemis.push(hemi);
      this.suns.push(sun);
      scene.add(hemi, sun);
    }

    const noise = noiseTexture();
    const ground = new THREE.MeshLambertMaterial({ vertexColors: true, map: noise, side: THREE.DoubleSide });
    const roadMat = new THREE.MeshLambertMaterial({ vertexColors: true, map: noise, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6 });
    const plants = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.terrain = new TerrainTiles(land, ground);
    this.roadMeshes = new RoadMeshes(land, roadMat);
    this.flora = new Flora(land, plants);
    this.scene.add(this.terrain.group, this.roadMeshes.group, this.flora.group, this.sky.mesh, this.water.mesh, this.motes.points, this.tyreFx.group);
    this.water.mesh.visible = land.map.biomes.some((b) => b.land.sea || b.land.lakes);
    this.disposables.push(noise, ground, roadMat, plants, this.terrain, this.roadMeshes, this.flora, this.sky, this.water, this.motes, this.tyreFx, this.mirrorTarget);

    const quad = new THREE.PlaneGeometry(2, 2);
    mirrorUv(quad, 0, 1);
    const frameMat = new THREE.MeshBasicMaterial({ color: '#111216' });
    const glassMat = new THREE.MeshBasicMaterial({ map: this.mirrorTarget.texture });
    this.screenFrame = new THREE.Mesh(quad, frameMat);
    this.screenGlass = new THREE.Mesh(quad, glassMat);
    this.screenMirror.add(this.screenFrame, this.screenGlass);
    this.disposables.push(quad, frameMat, glassMat);
  }

  setSize(width: number, height: number, devicePixelRatio: number): void {
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, MAX_PIXEL_RATIO));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = this.nearCamera.aspect = width / height;
    this.width = width;
  }

  /** Change the time of day (the light moves there slowly). */
  setTime(time: TimeOfDay): void {
    this.time = time;
    this.timeOverride = true;
  }

  get timeOfDay(): TimeOfDay {
    return this.time;
  }

  snap(): void {
    this.chaseHeading = null;
  }

  /** Make land near this point. Returns how far along the first build is (0-1). */
  prepare(x: number, y: number, index: number, budget: number): number {
    this.terrain.update(x, y, budget);
    this.roadMeshes.update(index, budget * 0.5);
    this.flora.update(x, y, budget);
    const left = this.terrain.pending + this.flora.pending;
    return left === 0 ? 1 : 1 / (1 + left * 0.02);
  }

  private updateLook(x: number, dt: number): void {
    const { land, current, goal, goalB } = this;
    const m = land.mix(x);
    const { a, b, t } = m;
    // A journey changes to each landscape's own time of day, until the driver picks one.
    const timeA = this.timeOverride ? this.time : a.time;
    const timeB = this.timeOverride ? this.time : b.time;
    lookFor(a, SKIES[timeA], goal);
    if (t > 0) {
      lookFor(b, SKIES[timeB], goalB);
      for (const k of COLOR_KEYS) goal[k].lerp(goalB[k], t);
      for (const k of NUMBER_KEYS) goal[k] += (goalB[k] - goal[k]) * t;
    }
    const rate = this.snapLook ? 1 : Math.min(1, dt * LOOK_RATE);
    this.snapLook = false;
    for (const k of COLOR_KEYS) current[k].lerp(goal[k], rate);
    for (const k of NUMBER_KEYS) current[k] += (goal[k] - current[k]) * rate;

    const h = current.sunHeight;
    const s = current.sunAngle;
    this.sunDir.set(Math.cos(s) * Math.cos(h), Math.sin(h), Math.sin(s) * Math.cos(h));
    for (const sun of this.suns) {
      sun.position.copy(this.sunDir);
      sun.color.copy(current.sun);
      sun.intensity = current.sunPower;
    }
    for (const hemi of this.hemis) {
      hemi.color.copy(current.ambientTop);
      hemi.groundColor.copy(current.ambientGround);
      hemi.intensity = current.ambient;
    }
    this.fog.color.copy(current.horizon);
    this.fog.density = current.haze;
    this.renderer.setClearColor(current.horizon);

    const u = this.sky.material.uniforms;
    (u.top.value as THREE.Color).copy(current.top);
    (u.horizon.value as THREE.Color).copy(current.horizon);
    (u.glow.value as THREE.Color).copy(current.glow);
    (u.sunColor.value as THREE.Color).copy(current.sun);
    (u.cloudColor.value as THREE.Color).copy(current.clouds);
    (u.cloudShade.value as THREE.Color).copy(current.cloudShade);
    (u.sunDir.value as THREE.Vector3).copy(this.sunDir);
    u.cover.value = current.cover;
    u.time.value = this.clock;

    const w = this.water.material.uniforms;
    (w.shallow.value as THREE.Color).copy(current.waterShallow);
    (w.deep.value as THREE.Color).copy(current.waterDeep);
    (w.skyColor.value as THREE.Color).copy(current.horizon);
    (w.sunColor.value as THREE.Color).copy(current.sun);
    (w.sunDir.value as THREE.Vector3).copy(this.sunDir);
    (w.fogTint.value as THREE.Color).copy(current.horizon);
    w.fogDensity.value = current.haze;
    w.time.value = this.clock;

    const main = t < 0.5 ? a : b;
    if (main.id !== this.moteBiome) {
      this.moteBiome = main.id;
      this.motes.set(main);
    }
  }

  private updateCar(car: RoadCarView, dt: number): Car3d {
    const key = `${car.livery.body}|${car.livery.wings}`;
    if (!this.model || key !== this.liveryKey) {
      this.model?.group.removeFromParent();
      this.model?.dispose();
      this.model = this.body === 'gt3' ? new Gt3Model(car.livery, { sky: 'day' }) : this.body === 'lmh' ? new LmhModel(car.livery, { sky: 'day' }) : new CarModel(car.livery);
      this.model.addSteeringWheel();
      this.model.addMirrorGlass(this.mirrorTarget.texture);
      this.near.add(this.model.group);
      this.liveryKey = key;
    }
    const m = this.model;
    m.update(car.x, car.y, car.heading, car.steer, car.drsOpen, 'medium');
    this.heat = brakeHeat(this.heat, car.brake, car.speed, dt);
    m.setBrakeHeat(this.heat);
    m.setLost(car.lost);
    m.setDamage(car.parts);
    const pitchTarget = Math.atan(car.uphill);
    this.pitch += (pitchTarget - this.pitch) * Math.min(1, dt * 8);
    m.group.position.y = car.z;
    m.group.rotation.z = this.pitch;
    const def = this.lookBack ? lookBackFor(this.body) : camsFor(this.body)[this.mode];
    m.driverVisible = !def.inside || this.lookBack;
    m.haloVisible = !def.noHalo;
    m.wheel?.drive(car.steer, car.speed, car.yawRate, car.wheel, dt, 0, car.slip, 0);
    m.wheel?.show(car.wheel);
    m.mirrorsVisible = this.mirror;
    return m;
  }

  private placeCamera(car: RoadCarView, dt: number): void {
    const cam = this.lookBack ? lookBackFor(this.body) : camsFor(this.body)[this.mode];
    let heading = car.heading;
    if (cam.chase) {
      if (this.chaseHeading === null) this.chaseHeading = heading;
      const diff = Math.atan2(Math.sin(heading - this.chaseHeading), Math.cos(heading - this.chaseHeading));
      this.chaseHeading += diff * Math.min(1, dt * 5);
      heading = this.chaseHeading;
    } else this.chaseHeading = null;
    const target = Math.max(-0.12, Math.min(0.12, car.yawRate * 0.1));
    this.lookInto += (target - this.lookInto) * Math.min(1, dt * 4);
    // Onboard cameras pitch with the car; chase cameras stay level.
    const pitch = cam.chase ? 0 : this.pitch;
    const pc = Math.cos(pitch);
    const ps = Math.sin(pitch);
    const toWorld = (q: readonly [number, number, number], yaw = 0): THREE.Vector3 => {
      const px = q[0] * pc - q[1] * ps;
      const py = q[0] * ps + q[1] * pc;
      const h = heading + yaw;
      const cos = Math.cos(h);
      const sin = Math.sin(h);
      return new THREE.Vector3(car.x + px * cos - q[2] * sin, py + car.z, car.y + px * sin + q[2] * cos);
    };
    const eye = toWorld(cam.eye);
    if (cam.chase) {
      const d = Math.hypot(cam.eye[0], cam.eye[2]);
      eye.set(car.x - Math.cos(heading) * d, cam.eye[1] + car.z, car.y - Math.sin(heading) * d);
      // Never inside a bank, off the road.
      eye.y = Math.max(eye.y, this.land.height(eye.x, eye.z) + 1.2);
    }
    this.camera.position.copy(eye);
    this.camera.lookAt(toWorld(cam.look, cam.chase ? 0 : this.lookInto));
    this.camera.fov = cam.fov + FOV_SPEED * Math.min(1, car.speed / 90);
    this.camera.updateProjectionMatrix();
  }

  private pixelScale(): number {
    const h = this.renderer.getDrawingBufferSize(new THREE.Vector2()).y;
    return h / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2));
  }

  render(car: RoadCarView, dt: number): void {
    this.clock += dt;
    this.renderer.info.reset();
    this.terrain.update(car.x, car.y, 3.5);
    this.roadMeshes.update(car.roadIndex, 1.5);
    this.flora.update(car.x, car.y, 2.5);
    this.updateLook(car.x, dt);
    this.updateCar(car, dt);
    this.placeCamera(car, dt);

    const list = new Map<string, TyreCar>();
    list.set('me', { x: car.x, y: car.y, heading: car.heading, speed: car.speed, brake: car.brake, throttle: car.throttle, slip: car.slip, ground: car.z, front: car.front, rear: car.rear });
    this.tyreFx.update(list, 0, this.camera.position, dt, this.pixelScale());

    this.water.mesh.position.set(this.camera.position.x, 0, this.camera.position.z);
    (this.water.material.uniforms.eye.value as THREE.Vector3).copy(this.camera.position);
    const u = this.motes.material.uniforms;
    (u.eye.value as THREE.Vector3).copy(this.camera.position);
    u.time.value = this.clock;
    u.pixels.value = this.pixelScale();

    const def = this.lookBack ? lookBackFor(this.body) : camsFor(this.body)[this.mode];
    if (this.mirror && this.mirrorFrame++ % 3 === 0) this.drawMirror(car);

    this.sky.mesh.position.copy(this.camera.position);
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    this.renderer.clearDepth();
    this.nearCamera.position.copy(this.camera.position);
    this.nearCamera.quaternion.copy(this.camera.quaternion);
    this.nearCamera.fov = this.camera.fov;
    this.nearCamera.updateProjectionMatrix();
    this.renderer.render(this.near, this.nearCamera);
    if (this.mirror && !def.inside && !this.lookBack) this.drawScreenMirror();
  }

  private drawMirror(car: RoadCarView): void {
    const cos = Math.cos(car.heading);
    const sin = Math.sin(car.heading);
    this.mirrorCamera.position.set(car.x + cos * EYE_POINT[0], 1.0 + car.z, car.y + sin * EYE_POINT[0]);
    this.mirrorCamera.lookAt(car.x - cos * 40, 0.4 + car.z, car.y - sin * 40);
    this.sky.mesh.position.copy(this.mirrorCamera.position);
    this.renderer.setRenderTarget(this.mirrorTarget);
    this.renderer.clear();
    this.tyreFx.showParticles(false);
    const motes = this.motes.points.visible;
    this.motes.points.visible = false;
    this.flora.group.visible = false;
    this.renderer.render(this.scene, this.mirrorCamera);
    this.flora.group.visible = true;
    this.motes.points.visible = motes;
    this.tyreFx.showParticles(true);
    this.renderer.setRenderTarget(null);
  }

  private drawScreenMirror(): void {
    const w = Math.min(420, this.width * 0.4);
    const h = w / 4;
    const x = (this.width - w) / 2;
    const size = this.renderer.getSize(new THREE.Vector2());
    const y = size.y - 10 - h;
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

  /** Draw calls in the last pass, for checking the budget. */
  get drawCalls(): number {
    return this.renderer.info.render.calls;
  }

  dispose(): void {
    this.model?.dispose();
    for (const d of this.disposables) d.dispose();
    this.renderer.dispose();
    this.canvas.remove();
  }
}
