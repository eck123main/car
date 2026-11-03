import * as THREE from 'three';
import type { Biome, TimeOfDay } from '../../sim/openRoad/biomes';

/** The sky and light at one time of day. Heights in radians; the road heads roughly +x. */
export interface SkyLook {
  sunHeight: number;
  /** Direction of the sun on the ground, 0 = dead ahead along the road's general direction. */
  sunAngle: number;
  sun: string;
  sunPower: number;
  ambient: number;
  ambientTop: string;
  ambientGround: string;
  top: string;
  horizon: string;
  /** Round the sun, near the horizon. */
  glow: string;
  clouds: string;
  cloudShade: string;
}

export const SKIES: Record<TimeOfDay, SkyLook> = {
  day: { sunHeight: 0.95, sunAngle: 0.8, sun: '#fff4dc', sunPower: 2.5, ambient: 1.25, ambientTop: '#dbeaff', ambientGround: '#7c8a5c', top: '#3f86d6', horizon: '#c7e0f2', glow: '#fff6dc', clouds: '#ffffff', cloudShade: '#b9c6d6' },
  golden: { sunHeight: 0.3, sunAngle: -0.75, sun: '#ffc98a', sunPower: 3, ambient: 2.05, ambientTop: '#d4dcec', ambientGround: '#a08a70', top: '#5a8ec8', horizon: '#f6d9b0', glow: '#ffc680', clouds: '#fff0d8', cloudShade: '#c89a80' },
  dusk: { sunHeight: 0.09, sunAngle: 0.1, sun: '#ff9a5c', sunPower: 3, ambient: 2, ambientTop: '#d0b8c8', ambientGround: '#94746c', top: '#3a4d8c', horizon: '#f59e6e', glow: '#ff7a3c', clouds: '#ffc090', cloudShade: '#7e5474' },
  dawn: { sunHeight: 0.14, sunAngle: 0.5, sun: '#ffd0c0', sunPower: 2.6, ambient: 1.95, ambientTop: '#c4cce4', ambientGround: '#8a8688', top: '#5270ac', horizon: '#f0c8c0', glow: '#ffb4a0', clouds: '#ffdcd4', cloudShade: '#8a7c9c' },
};

const SKY_VERTEX = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww;
  }
`;

const SKY_FRAGMENT = /* glsl */ `
  uniform vec3 top;
  uniform vec3 horizon;
  uniform vec3 glow;
  uniform vec3 sunColor;
  uniform vec3 cloudColor;
  uniform vec3 cloudShade;
  uniform vec3 sunDir;
  uniform float cover;
  uniform float time;
  varying vec3 vDir;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) {
      v += a * noise(p);
      p = p * 2.03 + vec2(13.1, 7.7);
      a *= 0.5;
    }
    return v;
  }

  void main() {
    vec3 d = normalize(vDir);
    float up = max(d.y, 0.0);
    // Fog colour exactly at the horizon, so far land melts into the sky.
    vec3 col = mix(horizon, top, 1.0 - pow(1.0 - up, 3.2));
    float sun = max(dot(d, sunDir), 0.0);
    col += glow * (pow(sun, 7.0) * 0.32 + pow(sun, 60.0) * 0.45) * smoothstep(-0.05, 0.1, d.y + 0.05);
    col += sunColor * smoothstep(0.9993, 0.9998, sun) * 3.0;
    // Clouds: a sheet of noise high overhead, thinning towards the horizon.
    if (d.y > 0.015) {
      vec2 uv = d.xz / (d.y + 0.12) * 1.25 + vec2(time * 0.004, time * 0.0013);
      float n = fbm(uv);
      float c = smoothstep(1.0 - cover - 0.1, 1.0 - cover + 0.24, n) * smoothstep(0.015, 0.2, d.y);
      float lit = clamp((fbm(uv + sunDir.xz * 0.12) - n) * 3.0 + 0.72, 0.0, 1.0);
      vec3 cloud = mix(cloudShade, cloudColor, lit) + glow * pow(sun, 14.0) * 0.4;
      col = mix(col, cloud, c * 0.92);
    }
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

const WATER_VERTEX = /* glsl */ `
  varying vec3 vWorld;
  varying float vDepth;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    vec4 mv = viewMatrix * w;
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const WATER_FRAGMENT = /* glsl */ `
  uniform vec3 shallow;
  uniform vec3 deep;
  uniform vec3 skyColor;
  uniform vec3 sunColor;
  uniform vec3 sunDir;
  uniform vec3 eye;
  uniform vec3 fogTint;
  uniform float fogDensity;
  uniform float time;
  uniform float ripple;
  varying vec3 vWorld;
  varying float vDepth;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float waves(vec2 p) {
    return noise(p * 0.11 + time * vec2(0.09, 0.05)) + 0.5 * noise(p * 0.31 - time * vec2(0.13, 0.07)) + 0.25 * noise(p * 0.83 + time * vec2(0.2, -0.16));
  }

  void main() {
    // Waves fade out with distance, or they'd shimmer.
    vec2 p = mod(vWorld.xz, 4096.0);
    float e = 0.7;
    float fade = 1.0 / (1.0 + vDepth * 0.0035);
    float h = waves(p);
    vec3 n = normalize(vec3((waves(p + vec2(e, 0.0)) - h) * ripple * fade, 1.0, (waves(p + vec2(0.0, e)) - h) * ripple * fade));
    vec3 v = normalize(eye - vWorld);
    float fresnel = pow(1.0 - max(dot(n, v), 0.0), 4.0);
    vec3 col = mix(deep, shallow, 0.35 + 0.65 * h * 0.5);
    col = mix(col, skyColor, 0.08 + fresnel * 0.42);
    vec3 r = reflect(-sunDir, n);
    col += sunColor * pow(max(dot(r, v), 0.0), 180.0) * 2.2;
    float f = 1.0 - exp(-fogDensity * fogDensity * vDepth * vDepth);
    gl_FragColor = vec4(mix(col, fogTint, f), 1.0);
    #include <colorspace_fragment>
  }
`;

const MOTE_VERTEX = /* glsl */ `
  attribute vec3 seed;
  uniform vec3 eye;
  uniform float time;
  uniform float fall;
  uniform float drift;
  uniform float box;
  uniform float size;
  uniform float pixels;
  void main() {
    vec3 p = seed * box;
    p.y -= time * fall * (0.7 + seed.x * 0.6);
    p.x += sin(time * 0.5 + seed.y * 40.0) * drift + time * drift * 0.4;
    p.z += cos(time * 0.4 + seed.z * 40.0) * drift;
    // Wrap into a box round the camera, wherever it is.
    p = mod(p - eye, vec3(box)) - box * 0.5 + eye;
    vec4 mv = viewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = min(14.0, size * pixels / max(1.0, -mv.z));
  }
`;

const MOTE_FRAGMENT = /* glsl */ `
  uniform vec3 color;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    if (dot(c, c) > 0.25) discard;
    gl_FragColor = vec4(color, 0.85);
    #include <colorspace_fragment>
  }
`;

/** Sky dome: gradient, sun and clouds. Drawn after the land, so hidden sky costs nothing. */
export class Sky {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;

  constructor() {
    this.material = new THREE.ShaderMaterial({
      vertexShader: SKY_VERTEX,
      fragmentShader: SKY_FRAGMENT,
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        top: { value: new THREE.Color() },
        horizon: { value: new THREE.Color() },
        glow: { value: new THREE.Color() },
        sunColor: { value: new THREE.Color() },
        cloudColor: { value: new THREE.Color() },
        cloudShade: { value: new THREE.Color() },
        sunDir: { value: new THREE.Vector3(0, 1, 0) },
        cover: { value: 0.4 },
        time: { value: 0 },
      },
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(100, 24, 14), this.material);
    this.mesh.renderOrder = 10;
    this.mesh.frustumCulled = false;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}

/** The one sheet of water at sea level, following the camera. */
export class Water {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;

  constructor() {
    this.material = new THREE.ShaderMaterial({
      vertexShader: WATER_VERTEX,
      fragmentShader: WATER_FRAGMENT,
      uniforms: {
        shallow: { value: new THREE.Color() },
        deep: { value: new THREE.Color() },
        skyColor: { value: new THREE.Color() },
        sunColor: { value: new THREE.Color() },
        sunDir: { value: new THREE.Vector3(0, 1, 0) },
        eye: { value: new THREE.Vector3() },
        fogTint: { value: new THREE.Color() },
        fogDensity: { value: 0.0001 },
        time: { value: 0 },
        ripple: { value: 0.45 },
      },
    });
    const geo = new THREE.PlaneGeometry(40000, 40000);
    geo.rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}

/** Snow, leaves, dust or pollen in the air round the camera: all moved in the shader. */
export class Motes {
  readonly points: THREE.Points;
  readonly material: THREE.ShaderMaterial;
  private static readonly MAX = 1600;

  constructor() {
    const seeds = new Float32Array(Motes.MAX * 3);
    for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('seed', new THREE.BufferAttribute(seeds, 3));
    // (three needs a position attribute to know how many points to draw.)
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(Motes.MAX * 3), 3));
    this.material = new THREE.ShaderMaterial({
      vertexShader: MOTE_VERTEX,
      fragmentShader: MOTE_FRAGMENT,
      transparent: true,
      depthWrite: false,
      uniforms: {
        eye: { value: new THREE.Vector3() },
        time: { value: 0 },
        fall: { value: 1 },
        drift: { value: 1 },
        box: { value: 70 },
        size: { value: 0.1 },
        pixels: { value: 800 },
        color: { value: new THREE.Color() },
      },
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 20;
    this.points.visible = false;
  }

  /** Show this biome's motes (none if it has none). */
  set(biome: Biome): void {
    const m = biome.air.motes;
    this.points.visible = !!m;
    if (!m) return;
    this.points.geometry.setDrawRange(0, Math.min(Motes.MAX, m.count));
    const u = this.material.uniforms;
    u.fall.value = m.fall;
    u.drift.value = m.drift;
    u.size.value = m.size;
    (u.color.value as THREE.Color).set(m.color);
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.material.dispose();
  }
}
