/**
 * Dev tool (`npm run dev`, then /car-sprites.html): renders each loaded car model (models.json)
 * from straight above, fitted to the class's axles exactly as in 3D (`prepareBody`), and saves
 * public/models/top/<id>.webp, plus <id>-mask.webp where it has parts painted in the player's
 * colour, and sprites.json. The top-down view draws these (`src/render/carSprites.ts`).
 * Rerun after adding or changing a model.
 */
import * as THREE from 'three';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { prepareBody, type BodySpec } from '../render3d/customBody';
import { SPRITE_FRAME, SPRITE_PX } from '../render/carSprites';
import type { CarClassId } from '../sim/carClass';

const out = document.getElementById('out')!;
const W = Math.round(SPRITE_FRAME.length * SPRITE_PX);
const H = Math.round(SPRITE_FRAME.width * SPRITE_PX);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(W, H);
renderer.setClearColor(0x000000, 0);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const hl = SPRITE_FRAME.length / 2;
const hw = SPRITE_FRAME.width / 2;
// Looking straight down: screen right = car forward (+x), screen down = car right (+z), as in 2D.
const camera = new THREE.OrthographicCamera(-hl, hl, hw, -hw, 0.1, 20);
camera.position.set(0, 10, 0);
camera.up.set(0, 0, -1);
camera.lookAt(0, 0, 0);

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
loader.setDRACOLoader(new DRACOLoader().setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/'));

async function save(name: string): Promise<string> {
  const blob = await new Promise<Blob>((ok) => renderer.domElement.toBlob((b) => ok(b!), 'image/webp', 0.9));
  const res = await fetch(`/__car-sprite/${name}`, { method: 'POST', body: blob });
  if (!res.ok) throw new Error(`saving ${name}: ${res.status}`);
  return URL.createObjectURL(blob);
}

function show(label: string, url: string): void {
  const p = document.createElement('div');
  p.textContent = label;
  const img = document.createElement('img');
  img.src = url;
  out.append(p, img);
}

async function run(): Promise<void> {
  const config = (await (await fetch('/models/models.json')).json()) as Record<string, (BodySpec & { id?: string })[]>;
  const manifest: Record<string, { mask: boolean }> = {};
  for (const [cls, list] of Object.entries(config)) {
    for (const spec of list) {
      if (!spec.id) continue;
      const gltf = await loader.loadAsync(`/models/${spec.file}`);
      const body = prepareBody(gltf.scene, spec, cls as CarClassId);
      if (!body) continue;
      const scene = new THREE.Scene();
      scene.add(new THREE.HemisphereLight('#ffffff', '#808080', 1.6));
      const sun = new THREE.DirectionalLight('#ffffff', 1.8);
      sun.position.set(1.5, 6, 2);
      scene.add(sun);
      const tinted: THREE.Mesh[] = [];
      for (const part of body.parts) {
        let mat = part.material;
        if (part.tinted && 'color' in mat) {
          // White: the game multiplies the player's colour in, using the mask.
          mat = mat.clone();
          (mat as THREE.MeshPhongMaterial).color.set('#ffffff');
        }
        const mesh = new THREE.Mesh(part.geometry, mat);
        scene.add(mesh);
        if (part.tinted) tinted.push(mesh);
      }
      renderer.render(scene, camera);
      show(`${spec.id} (${spec.file})`, await save(`${spec.id}.webp`));
      const mask = tinted.length > 0;
      if (mask) {
        // Mask: the painted parts white, everything else hiding them (black, then cut to alpha in game).
        const white = new THREE.MeshBasicMaterial({ color: '#ffffff' });
        const black = new THREE.MeshBasicMaterial({ color: '#000000' });
        scene.traverse((o) => {
          if (o instanceof THREE.Mesh) o.material = tinted.includes(o) ? white : black;
        });
        renderer.render(scene, camera);
        show(`${spec.id} mask`, await save(`${spec.id}-mask.webp`));
      }
      manifest[spec.id] = { mask };
    }
  }
  const res = await fetch('/__car-sprite/sprites.json', { method: 'POST', body: JSON.stringify(manifest, null, 2) + '\n' });
  const done = document.createElement('p');
  done.id = 'done';
  done.textContent = res.ok ? `Done: ${Object.keys(manifest).length} cars` : `sprites.json not saved: ${res.status}`;
  out.append(done);
}

run().catch((e) => {
  const p = document.createElement('p');
  p.id = 'done';
  p.textContent = `Failed: ${e}`;
  out.append(p);
  console.error(e);
});
