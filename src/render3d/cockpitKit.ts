import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Shared pieces for the cockpits, kept to one draw call each: a carbon weave on carbon parts (a
 * shader trick, no texture), steering wheels built as one vertex-coloured mesh, rounded gloves,
 * a labelled switch panel (one canvas texture) and the drift car's hydraulic handbrake.
 */

/** The carbon colour every car model paints its carbon parts with. */
export const CARBON = '#1c1d20';
const carbonLinear = new THREE.Color(CARBON);
const f = (v: number) => v.toFixed(5);

/**
 * Twill-weave carbon on every face painted exactly `CARBON` (vertex colours), faded out where the
 * weave would shimmer (far away). Other colours, and ghosts or flat-painted cars, are untouched.
 */
export function carbonWeave<T extends THREE.MeshLambertMaterial | THREE.MeshPhongMaterial>(mat: T): T {
  mat.customProgramCacheKey = () => 'carbon-weave';
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWeavePos;\nvarying vec3 vWeaveNormal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWeavePos = position;\nvWeaveNormal = normal;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWeavePos;\nvarying vec3 vWeaveNormal;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
#ifdef USE_COLOR
{
  float isCarbon = 1.0 - step(0.0009, length(vColor.rgb - vec3(${f(carbonLinear.r)}, ${f(carbonLinear.g)}, ${f(carbonLinear.b)})));
  vec3 an = abs(vWeaveNormal);
  vec2 cp = an.x > an.y && an.x > an.z ? vWeavePos.zy : (an.y > an.z ? vWeavePos.xz : vWeavePos.xy);
  cp *= 75.0;
  vec2 cell = floor(cp);
  vec2 fr = fract(cp);
  // 2x2 twill: tows run one way in a cell, the other way in the next, stepping diagonally.
  float along = mod(cell.x + floor(cell.y * 0.5) * 2.0 + cell.y, 2.0) < 1.0 ? fr.x : fr.y;
  float across = mod(cell.x + floor(cell.y * 0.5) * 2.0 + cell.y, 2.0) < 1.0 ? fr.y : fr.x;
  float shade = 0.62 + 0.62 * sin(along * 3.14159) * (0.85 + 0.15 * sin(across * 6.2832));
  float sharp = clamp(1.6 - length(fwidth(cp)) * 1.4, 0.0, 1.0);
  diffuseColor.rgb *= mix(1.0, shade, isCarbon * sharp);
}
#endif`,
      );
  };
  mat.needsUpdate = true;
  return mat;
}

/** A geometry with one colour on every vertex, no UVs, not indexed (so it merges with others). */
export function colored(geo: THREE.BufferGeometry, color: string): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  const c = new THREE.Color(color);
  const n = g.getAttribute('position').count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const out = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  return out;
}

/** A small round thing facing the driver (-x): a button, a knob. */
const facing = (r: number, depth: number, seg = 10) => new THREE.CylinderGeometry(r, r, depth, seg).rotateZ(Math.PI / 2);

/**
 * An F1 wheel (frame of `SteeringWheel.inner`: x away from the driver, y up, z across): a carbon
 * body shaped like the real ones (flat top, the grips sweeping down either side), rubber grips,
 * coloured buttons and rotary dials round the display, a strip of the car's colour on top.
 */
export function f1WheelGeometry(trim: string): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(-0.105, 0.072);
  s.lineTo(0.105, 0.072);
  s.quadraticCurveTo(0.15, 0.072, 0.16, 0.045);
  s.lineTo(0.185, -0.05);
  s.quadraticCurveTo(0.188, -0.085, 0.155, -0.088);
  s.lineTo(0.11, -0.08);
  s.quadraticCurveTo(0, -0.1, -0.11, -0.08);
  s.lineTo(-0.155, -0.088);
  s.quadraticCurveTo(-0.188, -0.085, -0.185, -0.05);
  s.lineTo(-0.16, 0.045);
  s.quadraticCurveTo(-0.15, 0.072, -0.105, 0.072);
  // Extruded towards +z, then turned so the shape stands across the car facing the driver.
  const body = new THREE.ExtrudeGeometry(s, { depth: 0.032, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 1, curveSegments: 6 })
    .rotateY(-Math.PI / 2)
    .translate(0.016, 0, 0);
  const parts = [colored(body, CARBON)];
  // Grips: rubber, rounded, where the hands go.
  for (const side of [-1, 1]) {
    parts.push(colored(new THREE.CapsuleGeometry(0.027, 0.1, 3, 8).translate(0.008, -0.012, side * 0.155), '#0e0e0f'));
  }
  // Strip along the top in the car's colour.
  parts.push(colored(new THREE.BoxGeometry(0.03, 0.008, 0.2).translate(-0.004, 0.073, 0), trim));
  // Buttons round the display: two rows each side, in their own colours with a dark bezel.
  const buttons = ['#e8262b', '#2f6dff', '#27b34a', '#ffcf1f', '#f2f2f2', '#ff7a1a', '#b05cff', '#4dd2ff'];
  let k = 0;
  for (const side of [-1, 1]) {
    for (const [y, z] of [[0.048, 0.085], [0.048, 0.115], [-0.035, 0.085], [-0.035, 0.115]]) {
      parts.push(colored(facing(0.011, 0.006).translate(-0.02, y, side * z), '#0a0a0b'));
      parts.push(colored(facing(0.008, 0.008).translate(-0.023, y, side * z), buttons[k++ % buttons.length]));
    }
  }
  // Rotary dials under the display, white pointers.
  for (const z of [-0.06, -0.02, 0.02, 0.06]) {
    parts.push(colored(facing(0.0125, 0.014, 12).translate(-0.024, -0.058, z), '#2a2b30'));
    parts.push(colored(new THREE.BoxGeometry(0.003, 0.011, 0.002).translate(-0.032, -0.053, z), '#f2f2f2'));
  }
  return merge(parts);
}

/**
 * A GT wheel (same frame): a thick round rim in suede with a flat bottom, a shaped carbon centre
 * plate, small lit buttons, two rotary knobs with pointers, a marker on top in the car's colour.
 */
export function gtWheelGeometry(trim: string): THREE.BufferGeometry {
  const rim = new THREE.TorusGeometry(0.155, 0.021, 8, 36, Math.PI * 1.55).rotateZ(-Math.PI * 0.275).rotateY(Math.PI / 2);
  const parts = [colored(rim, '#18181b')];
  parts.push(colored(new THREE.CapsuleGeometry(0.019, 0.21, 3, 8).rotateX(Math.PI / 2).translate(0, -0.124, 0), '#18181b'));
  // Thicker, grippier rubber where the hands hold it.
  for (const side of [-1, 1]) {
    parts.push(colored(new THREE.CapsuleGeometry(0.025, 0.07, 3, 8).rotateX(side * 0.25).translate(0, -0.01, side * 0.153), '#0c0c0d'));
  }
  const s = new THREE.Shape();
  s.moveTo(-0.08, 0.06);
  s.lineTo(0.08, 0.06);
  s.quadraticCurveTo(0.1, 0.06, 0.1, 0.04);
  s.lineTo(0.14, 0.0);
  s.lineTo(0.14, -0.035);
  s.lineTo(0.09, -0.05);
  s.quadraticCurveTo(0.06, -0.11, 0.0, -0.11);
  s.quadraticCurveTo(-0.06, -0.11, -0.09, -0.05);
  s.lineTo(-0.14, -0.035);
  s.lineTo(-0.14, 0.0);
  s.lineTo(-0.1, 0.04);
  s.quadraticCurveTo(-0.1, 0.06, -0.08, 0.06);
  const plate = new THREE.ExtrudeGeometry(s, { depth: 0.024, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.003, bevelSegments: 1, curveSegments: 5 })
    .rotateY(-Math.PI / 2)
    .translate(0.014, 0, 0);
  parts.push(colored(plate, CARBON));
  // The marker at the top of the rim.
  parts.push(colored(new THREE.BoxGeometry(0.046, 0.034, 0.022).translate(0, 0.155, 0), trim));
  // Lit buttons: three rows of two each side of the middle, a bezel round each.
  const lit = ['#e8262b', '#27b34a', '#2f6dff', '#ffcf1f', '#f2f2f2', '#ff7a1a'];
  let k = 0;
  for (const side of [-1, 1]) {
    for (const y of [0.035, 0.008, -0.019]) {
      for (const z of [0.045, 0.075]) {
        parts.push(colored(facing(0.0105, 0.005).translate(-0.016, y, side * z), '#0a0a0b'));
        parts.push(colored(facing(0.0078, 0.007).translate(-0.019, y, side * z), lit[k++ % lit.length]));
      }
    }
    // Shift paddles' mounts and the funky-switch on the spoke.
    parts.push(colored(facing(0.014, 0.012, 12).translate(-0.02, -0.03, side * 0.115), '#5a5c63'));
  }
  // Two rotaries low in the middle (TC, ABS), white pointers.
  for (const z of [-0.025, 0.025]) {
    parts.push(colored(facing(0.016, 0.018, 14).translate(-0.022, -0.066, z), '#2a2b30'));
    parts.push(colored(new THREE.BoxGeometry(0.003, 0.013, 0.003).translate(-0.032, -0.06, z), '#f2f2f2'));
  }
  // Pit limiter and radio: two bigger buttons at the top.
  parts.push(colored(facing(0.011, 0.008).translate(-0.02, 0.045, -0.012), '#4dd2ff'));
  parts.push(colored(facing(0.011, 0.008).translate(-0.02, 0.045, 0.012), '#ffcf1f'));
  return merge(parts);
}

/** Rounded glove parts (sizes as the old boxes): the hand, the fingers round the grip, the thumb, the strap. */
export function gloveGeometries(): { hand: THREE.BufferGeometry; fingers: THREE.BufferGeometry; thumb: THREE.BufferGeometry; strap: THREE.BufferGeometry; cuff: THREE.BufferGeometry } {
  const hand = new THREE.SphereGeometry(1, 12, 8).scale(0.038, 0.052, 0.036);
  // Four fingers, each a half ring round the front of the grip (axis y), stacked down it.
  const rings: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 4; i++) {
    const r = new THREE.TorusGeometry(0.03, 0.0115, 6, 10, Math.PI).rotateX(Math.PI / 2).rotateY(Math.PI / 2);
    r.translate(0, 0.033 - i * 0.022, 0);
    const g = r.toNonIndexed();
    g.deleteAttribute('uv');
    rings.push(g);
  }
  const fingers = merge(rings);
  const thumb = new THREE.CapsuleGeometry(0.012, 0.035, 3, 8).rotateX(Math.PI / 2);
  const strap = new THREE.SphereGeometry(1, 10, 6).scale(0.005, 0.016, 0.026);
  const cuff = new THREE.CylinderGeometry(0.043, 0.036, 0.075, 10);
  return { hand, fingers, thumb, strap, cuff };
}

const panels = new Map<string, THREE.CanvasTexture>();

/**
 * A race car's switch panel: guarded toggles and lit push buttons in labelled rows on carbon, as
 * the real ones (ignition, starter, lights, rain light, wipers, pit limiter, fans, drink...). One
 * small texture, shared by every car.
 */
export function switchPanelTexture(kind: 'console' | 'side'): THREE.CanvasTexture {
  let t = panels.get(kind);
  if (t) return t;
  const c = document.createElement('canvas');
  const w = kind === 'console' ? 256 : 384;
  const h = kind === 'console' ? 448 : 256;
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  // Carbon background: a fine diagonal weave.
  g.fillStyle = '#16171a';
  g.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y += 6) {
    for (let x = 0; x < w; x += 6) {
      g.fillStyle = (x / 6 + y / 6) % 2 ? '#1d1e22' : '#121316';
      g.fillRect(x, y, 6, 6);
    }
  }
  // A brushed alloy edge and four screws.
  g.strokeStyle = '#6d7078';
  g.lineWidth = 4;
  g.strokeRect(2, 2, w - 4, h - 4);
  g.fillStyle = '#a9adb5';
  for (const [x, y] of [[10, 10], [w - 10, 10], [10, h - 10], [w - 10, h - 10]]) {
    g.beginPath();
    g.arc(x, y, 4, 0, Math.PI * 2);
    g.fill();
  }
  const label = (text: string, x: number, y: number) => {
    g.fillStyle = '#e9ebef';
    g.font = 'bold 13px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, x, y);
  };
  /** A toggle under a flip-up guard in `guard`'s colour. */
  const toggle = (x: number, y: number, text: string, guard: string, on: boolean) => {
    g.fillStyle = guard;
    g.beginPath();
    g.roundRect(x - 17, y - 22, 34, 44, 5);
    g.fill();
    g.fillStyle = '#0b0b0d';
    g.beginPath();
    g.arc(x, y, 10, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#d7dadf';
    g.beginPath();
    g.roundRect(x - 3.5, on ? y - 18 : y, 7, 18, 3);
    g.fill();
    g.beginPath();
    g.arc(x, on ? y - 18 : y + 18, 5, 0, Math.PI * 2);
    g.fill();
    label(text, x, y + 34);
  };
  /** A lit push button. */
  const button = (x: number, y: number, text: string, color: string) => {
    g.fillStyle = '#3a3c42';
    g.beginPath();
    g.arc(x, y, 17, 0, Math.PI * 2);
    g.fill();
    const grad = g.createRadialGradient(x - 4, y - 4, 2, x, y, 13);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.35, color);
    grad.addColorStop(1, color);
    g.fillStyle = grad;
    g.beginPath();
    g.arc(x, y, 13, 0, Math.PI * 2);
    g.fill();
    label(text, x, y + 30);
  };
  if (kind === 'console') {
    // Read from the seat: the top of the texture is the far end of the console.
    label('— POWER —', w / 2, 26);
    toggle(56, 72, 'IGN', '#d0202e', true);
    toggle(128, 72, 'FUEL', '#d0202e', true);
    button(200, 72, 'START', '#27c24a');
    label('— LIGHTS —', w / 2, 140);
    toggle(56, 186, 'HEAD', '#2a2c31', true);
    toggle(128, 186, 'RAIN', '#2a2c31', false);
    toggle(200, 186, 'WIPE', '#2a2c31', false);
    label('— AUX —', w / 2, 254);
    button(56, 298, 'PIT', '#4dd2ff');
    button(128, 298, 'FAN', '#ff8a1a');
    button(200, 298, 'DRINK', '#f2f2f2');
    toggle(56, 384, 'DEMIST', '#2a2c31', true);
    toggle(128, 384, 'RADIO', '#2a2c31', true);
    button(200, 384, 'EXT', '#e8262b');
  } else {
    label('POWER', 64, 22);
    toggle(40, 68, 'IGN', '#d0202e', true);
    toggle(96, 68, 'FUEL', '#d0202e', true);
    button(160, 68, 'START', '#27c24a');
    toggle(224, 68, 'HYB', '#ffcf1f', true);
    button(290, 68, 'EXT', '#e8262b');
    button(348, 68, 'PIT', '#4dd2ff');
    toggle(40, 176, 'HEAD', '#2a2c31', true);
    toggle(96, 176, 'RAIN', '#2a2c31', false);
    toggle(152, 176, 'WIPE', '#2a2c31', false);
    button(220, 176, 'FAN', '#ff8a1a');
    button(284, 176, 'DRINK', '#f2f2f2');
    button(348, 176, 'RADIO', '#b05cff');
  }
  t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  panels.set(kind, t);
  return t;
}

/**
 * A switch panel mesh: lit by the scene, its buttons glowing a little on their own (night).
 * `width` across the car, `length` along it (console: lying on a slope; side: standing, facing the driver).
 */
export function switchPanel(kind: 'console' | 'side', width: number, length: number): THREE.Mesh {
  const map = switchPanelTexture(kind);
  const geo = new THREE.PlaneGeometry(width, length);
  if (kind === 'console') geo.rotateZ(-Math.PI / 2).rotateX(-Math.PI / 2);
  else geo.rotateY(-Math.PI / 2);
  const mat = new THREE.MeshLambertMaterial({ map, emissiveMap: map, emissive: '#ffffff', emissiveIntensity: 0.18 });
  return new THREE.Mesh(geo, mat);
}

/** The drift car's hydraulic handbrake: a tall lever on the tunnel, red grip, pivot at the origin (it swings about z). */
export function handbrakeGeometry(): { lever: THREE.BufferGeometry; base: THREE.BufferGeometry; length: number } {
  const length = 0.32;
  const lever = merge([
    colored(new THREE.CylinderGeometry(0.011, 0.013, length, 8).translate(0, length / 2, 0), '#c4c7cc'),
    colored(new THREE.CapsuleGeometry(0.02, 0.07, 3, 8).translate(0, length + 0.01, 0), '#d0202e'),
    colored(new THREE.SphereGeometry(0.015, 8, 6).translate(0, length + 0.06, 0), '#0b0b0d'),
  ]);
  const base = merge([
    colored(new THREE.BoxGeometry(0.18, 0.3, 0.08).translate(0, -0.15, 0), CARBON),
    colored(new THREE.CylinderGeometry(0.022, 0.022, 0.12, 10).rotateZ(Math.PI / 2).translate(0.06, -0.035, 0.05), '#c9a23a'),
    colored(new THREE.BoxGeometry(0.03, 0.04, 0.09).translate(0, 0.005, 0), '#5a5c63'),
  ]);
  return { lever, base, length };
}

/** A sequential shifter: a short lever with a big knob, in the car frame (`at` is its foot). */
export function shifterGeometry(at: [number, number, number]): THREE.BufferGeometry {
  const [x, y, z] = at;
  return merge([
    colored(new THREE.BoxGeometry(0.12, 0.04, 0.08).translate(x, y, z), '#2a2b30'),
    colored(new THREE.CylinderGeometry(0.01, 0.012, 0.24, 8).rotateZ(0.18).translate(x - 0.02, y + 0.12, z), '#c4c7cc'),
    colored(new THREE.SphereGeometry(0.028, 10, 8).scale(1, 1.25, 1).translate(x - 0.042, y + 0.25, z), '#0b0b0d'),
  ]);
}
