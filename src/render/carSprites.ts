/**
 * Top-down pictures of the real cars (garage cars, `src/cosmetics/cars.ts`), rendered from their
 * 3D models by the dev tool /car-sprites.html (`src/tools/carSprites.ts`) into public/models/top/.
 * Loaded on first use; until a picture is ready (or if it's missing) the car is drawn as the
 * built-in one. Parts the 3D view paints in the player's colour come with a mask and are tinted here.
 */

/** The picture's frame in the car's frame (m), centred on the car's origin, nose along +x. */
export const SPRITE_FRAME = { length: 5.5, width: 2.5 };
/** Pixels per metre in the pictures. */
export const SPRITE_PX = 100;

interface Sprite {
  img: HTMLImageElement;
  mask: HTMLImageElement | null;
  ready: boolean;
  /** The picture with the mask tinted, per colour. */
  tinted: Map<string, HTMLCanvasElement>;
}

let manifest: Record<string, { mask: boolean }> | null = null;
let listing: Promise<void> | null = null;
const sprites = new Map<string, Sprite>();

const base = () => `${import.meta.env.BASE_URL}models/top/`;

function list(): void {
  listing ??= fetch(`${base()}sprites.json`)
    .then((r) => (r.ok && (r.headers.get('content-type') ?? '').includes('json') ? r.json() : {}))
    .then((m: Record<string, { mask: boolean }>) => {
      manifest = m;
    })
    .catch(() => {
      manifest = {};
    });
}

function image(src: string, done: () => void): HTMLImageElement {
  const img = new Image();
  img.onload = done;
  img.src = src;
  return img;
}

/** The car's picture painted in `color`, or null while it loads (draw the built-in car then). */
export function carSprite(id: string, color: string): CanvasImageSource | null {
  if (typeof Image === 'undefined') return null;
  list();
  if (!manifest) return null;
  let s = sprites.get(id);
  if (!s) {
    const entry = manifest[id];
    if (!entry) return null;
    let waiting = entry.mask ? 2 : 1;
    const done = () => {
      if (--waiting === 0) s!.ready = true;
    };
    s = { img: image(`${base()}${id}.webp`, done), mask: entry.mask ? image(`${base()}${id}-mask.webp`, done) : null, ready: false, tinted: new Map() };
    sprites.set(id, s);
  }
  if (!s.ready) return null;
  if (!s.mask) return s.img;
  let c = s.tinted.get(color);
  if (!c) {
    c = tint(s.img, s.mask, color);
    if (s.tinted.size > 24) s.tinted.clear();
    s.tinted.set(color, c);
  }
  return c;
}

/** The picture with the colour multiplied into its white painted parts (where the mask is white). */
function tint(img: HTMLImageElement, mask: HTMLImageElement, color: string): HTMLCanvasElement {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const paint = document.createElement('canvas');
  paint.width = w;
  paint.height = h;
  const pc = paint.getContext('2d')!;
  // Colour where the mask is white, nothing elsewhere: the mask's brightness becomes alpha.
  pc.drawImage(mask, 0, 0, w, h);
  const px = pc.getImageData(0, 0, w, h);
  pc.fillStyle = color;
  pc.fillRect(0, 0, 1, 1);
  const [r, g, b] = pc.getImageData(0, 0, 1, 1).data;
  for (let i = 0; i < px.data.length; i += 4) {
    const a = (px.data[i] * px.data[i + 3]) / 255;
    px.data[i] = r;
    px.data[i + 1] = g;
    px.data[i + 2] = b;
    px.data[i + 3] = a;
  }
  pc.putImageData(px, 0, 0);
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const oc = out.getContext('2d')!;
  oc.drawImage(img, 0, 0);
  // Multiply the colour into the (white, shaded) paint, then keep the picture's own outline.
  oc.globalCompositeOperation = 'multiply';
  oc.drawImage(paint, 0, 0);
  oc.globalCompositeOperation = 'destination-in';
  oc.drawImage(img, 0, 0);
  return out;
}
