import { type BuildingKind, type FarmAnimal, type Rgb, rgb } from '../../sim/openRoad/biomes';
import { FENCE_BAY } from '../../sim/openRoad/farms';
import { Builder, type Template } from './flora';

const BLACK: Rgb = [0, 0, 0];
const DARK = rgb('#26221e');
const SLATE = rgb('#4a4c52');
const RED_ROOF = rgb('#8a3a2c');
const TERRACOTTA = rgb('#b8603c');
const SNOW = rgb('#f2f5fa');
const METAL = rgb('#9aa0a4');
const WHITE = rgb('#ece8dc');
const STONE = rgb('#8c8880');
const WOOD = rgb('#5e4630');
const STRAW = rgb('#d4b45a');

/** Walls take the building's own colour; they run well into the ground, for slopes. */
function walls(b: Builder, hl: number, hw: number, height: number): void {
  b.box(-hl, hl, -3, height, -hw, hw, 1, BLACK);
}

/** A door on the long side and windows along it, just proud of the wall. */
function front(b: Builder, hl: number, hw: number, doorW: number, doorH: number, windows: number, windowY: number): void {
  b.box(-doorW, doorW, 0, doorH, -hw - 0.08, -hw + 0.1, 0, DARK);
  for (let i = 0; i < windows; i++) {
    const x = -hl + ((i + 0.5) / windows) * hl * 2;
    if (Math.abs(x) < doorW + 1) continue;
    b.box(x - 0.6, x + 0.6, windowY, windowY + 1.1, -hw - 0.06, -hw + 0.1, 0, DARK);
  }
}

function makeBuilding(kind: BuildingKind): Template {
  const b = new Builder();
  switch (kind) {
    case 'barn':
      walls(b, 10, 6, 6);
      front(b, 10, 6, 2.6, 4.4, 0, 0);
      b.gable(-10.6, 10.6, 6, 10.5, -6.8, 6.8, SLATE);
      break;
    case 'smallBarn':
      walls(b, 6, 4, 3.8);
      front(b, 6, 4, 1.7, 3, 0, 0);
      b.gable(-6.4, 6.4, 3.8, 6.4, -4.5, 4.5, SLATE);
      break;
    case 'silo':
      b.cone(-3, 13, 3, 3, 0, METAL, { sides: 8 });
      b.cone(13, 15.5, 3.1, 0.2, 0, SLATE, { sides: 8 });
      break;
    case 'house':
      walls(b, 6, 4, 5);
      front(b, 6, 4, 0.8, 2.3, 4, 2.6);
      b.gable(-6.5, 6.5, 5, 8, -4.6, 4.6, RED_ROOF);
      b.box(3, 4, 6, 9.4, 0.4, 1.4, 0, STONE);
      break;
    case 'windmill':
      b.cone(-3, 15, 4.6, 2.5, 0, WHITE, { sides: 8 });
      b.cone(15, 17.5, 2.9, 0.3, 0, DARK, { sides: 8 });
      // Four sails, facing out from the cap.
      for (const [dy, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const hub = 15;
        const out = 3;
        const len = 9;
        const wide = 0.9;
        const sy = dz !== 0 ? wide : 0.15;
        const sz = dy !== 0 ? wide : 0.15;
        b.box(out, out + 0.2, hub + dy * len * 0.5 - (dy !== 0 ? len * 0.5 : sy), hub + dy * len * 0.5 + (dy !== 0 ? len * 0.5 : sy), dz * len * 0.5 - (dz !== 0 ? len * 0.5 : sz), dz * len * 0.5 + (dz !== 0 ? len * 0.5 : sz), 0, WHITE);
      }
      break;
    case 'chalet':
      b.box(-7, 7, -3, 2.4, -5, 5, 0, STONE);
      b.box(-7, 7, 2.4, 6, -5, 5, 1, BLACK);
      front(b, 7, 5, 0.9, 2.2, 4, 3.4);
      b.box(-7.6, 7.6, 2.5, 2.8, -6.3, -5, 0, WOOD);
      b.gable(-9, 9, 6, 9, -6.8, 6.8, DARK);
      break;
    case 'cabin':
      walls(b, 4.5, 3.2, 3);
      front(b, 4.5, 3.2, 0.7, 2, 3, 1.4);
      b.gable(-5.2, 5.2, 3, 5.4, -4, 4, SNOW);
      b.box(2, 2.8, 4, 6.4, 0.2, 1, 0, STONE);
      break;
    case 'shed':
      walls(b, 3.4, 2.4, 2.6);
      front(b, 3.4, 2.4, 1, 2, 0, 0);
      b.gable(-3.7, 3.7, 2.6, 3.8, -2.7, 2.7, METAL);
      break;
    case 'ranch':
      walls(b, 8.5, 4, 3.4);
      front(b, 8.5, 4, 0.9, 2.3, 6, 1.5);
      b.gable(-9.4, 9.4, 3.4, 5, -5, 5, TERRACOTTA);
      break;
    case 'windpump': {
      for (const [x, z] of [[-1.3, -1.3], [1.3, -1.3], [0, 1.5]] as const) b.cone(-2, 10.5, 0.14, 0.09, 0, DARK, { sides: 3, ox: x, oz: z, lean: -x * 0.9 });
      b.box(0.2, 0.4, 9, 13.4, -2.2, 2.2, 0, METAL);
      b.box(-2.2, 0.2, 11, 11.2, -0.1, 0.1, 0, DARK);
      break;
    }
    case 'villa':
      walls(b, 7, 5, 6.2);
      front(b, 7, 5, 1, 2.5, 5, 3.6);
      b.gable(-7.6, 7.6, 6.2, 8.8, -5.6, 5.6, TERRACOTTA);
      break;
  }
  return b;
}

const buildings = new Map<BuildingKind, Template>();
export function buildingTemplate(kind: BuildingKind): Template {
  let t = buildings.get(kind);
  if (!t) {
    t = makeBuilding(kind);
    buildings.set(kind, t);
  }
  return t;
}

/** Posts at each end of a bay, two rails between, tinted the farm's fence colour. */
function makeFenceBay(): Template {
  const b = new Builder();
  const half = FENCE_BAY / 2;
  b.box(-half - 0.08, -half + 0.08, -0.5, 1.15, -0.08, 0.08, 1, BLACK);
  b.box(half - 0.08, half + 0.08, -0.5, 1.15, -0.08, 0.08, 1, BLACK);
  b.box(-half, half, 0.5, 0.62, -0.03, 0.03, 1, BLACK);
  b.box(-half, half, 0.92, 1.04, -0.03, 0.03, 1, BLACK);
  return b;
}

function makeCow(): Template {
  const b = new Builder();
  b.box(-0.8, 0.8, 0.65, 1.35, -0.33, 0.33, 1, BLACK);
  b.box(0.75, 1.3, 0.95, 1.4, -0.18, 0.18, 1, BLACK);
  for (const [x, z] of [[-0.65, -0.24], [-0.65, 0.24], [0.6, -0.24], [0.6, 0.24]] as const) b.box(x - 0.08, x + 0.08, 0, 0.7, z - 0.08, z + 0.08, 0, DARK);
  return b;
}

function makeSheep(): Template {
  const b = new Builder();
  b.blob(0, 0.55, 0, 0.45, 0.33, 0, WHITE, 3);
  b.box(0.4, 0.68, 0.5, 0.78, -0.09, 0.09, 0, DARK);
  for (const [x, z] of [[-0.25, -0.15], [-0.25, 0.15], [0.25, -0.15], [0.25, 0.15]] as const) b.box(x - 0.04, x + 0.04, 0, 0.32, z - 0.04, z + 0.04, 0, DARK);
  return b;
}

function makeBale(): Template {
  const b = new Builder();
  b.cone(0, 1.4, 0.8, 0.8, 0, STRAW, { sides: 7 });
  b.cone(1.4, 1.42, 0.8, 0.05, 0, STRAW, { sides: 7 });
  return b;
}

const details = new Map<string, Template>();
export function detailTemplate(kind: 'fence' | 'bale' | FarmAnimal): Template {
  let t = details.get(kind);
  if (!t) {
    t = kind === 'fence' ? makeFenceBay() : kind === 'cow' ? makeCow() : kind === 'sheep' ? makeSheep() : makeBale();
    details.set(kind, t);
  }
  return t;
}

/** Cows come in a few colours. */
export const COW_TINTS = ['#2a2624', '#6e4a30', '#e4dccc', '#8a5a3a'];
