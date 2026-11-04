/**
 * The open road's landscapes. All of this is data: a new scene is a new entry here (shapes of the
 * land, the road's character, colours, plants, sky). See Land for how the numbers are used.
 */

export type Rgb = [number, number, number];

/** A '#rrggbb' colour in the linear space three.js lights in. */
export function rgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16);
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return [lin((n >> 16) & 255), lin((n >> 8) & 255), lin(n & 255)];
}

export type PlantKind = 'pine' | 'snowPine' | 'broadleaf' | 'birch' | 'poplar' | 'cactus' | 'palm' | 'shrub' | 'rock' | 'boulder' | 'tuft' | 'flower' | 'stone' | 'drift';

export interface PlantDef {
  kind: PlantKind;
  /** How common, against the others in the list. */
  weight: number;
  /** Height range (m). */
  size: [number, number];
  /** Foliage colours, one picked per plant. */
  tints: string[];
}

export type TimeOfDay = 'dawn' | 'day' | 'golden' | 'dusk';
export const TIMES: TimeOfDay[] = ['day', 'golden', 'dusk', 'dawn'];
export const TIME_NAMES: Record<TimeOfDay, string> = { dawn: 'Dawn', day: 'Midday', golden: 'Golden hour', dusk: 'Sunset' };

/** What lines the road over hills and round hairpins. All of them are solid. */
export interface FenceDef {
  kind: 'rail' | 'wood' | 'wire';
  color: string;
  /** Fenced where a hill lifts the land more than this (m). */
  hillFrom: number;
}

/**
 * One hill per `every` metres of x, up to half that wide. Some are climbs: too steep for the road
 * to go straight up, so it zigzags up one side and down the other with hairpins.
 */
export interface RidgeDef {
  every: number;
  hill: { height: [number, number]; width: [number, number] };
  /** Share of the hills that are climbs. */
  climbs: number;
  climb: { height: [number, number]; width: [number, number] };
}

export interface Biome {
  id: string;
  name: string;
  blurb: string;
  /** Colours for the menu's picture: sky, far land, near land, road. */
  card: [string, string, string, string];
  time: TimeOfDay;
  road: {
    /** Straight stretches (m). */
    straight: [number, number];
    /** Corner radius (m) and how far a corner turns (deg). */
    radius: [number, number];
    angle: [number, number];
    /** Chance a corner flows straight into one the other way. */
    esses: number;
    /** Steepest climb (rise per metre). */
    grade: number;
    /** Hairpin radius (m) and the length of the legs between them on a zigzag climb (m). */
    hairpin: [number, number];
    leg: [number, number];
    fence: FenceDef;
    asphalt: string;
    shoulder: string;
    line: string;
    /** The dashes down the middle. */
    centre: string;
    post: string;
    postTop: string;
  };
  land: {
    /** Height of the valley floor the road follows (m, sea level is 0). */
    base: number;
    hills: { amp: number; scale: number };
    roll: { amp: number; scale: number };
    /** Ranges rising either side of the road. */
    mountains?: { amp: number; scale: number; near: number; far: number; rise: number };
    /** Flat-topped rocks standing up from the plain. */
    mesas?: { height: number; scale: number; near: number };
    /** The sea, on the right of the road, from this far (m) off it. */
    sea?: { near: number; far: number; width: number };
    /** Lakes in the low ground. */
    lakes?: { scale: number; depth: number; threshold: number };
    /** How steeply cuttings and embankments rise from the road (rise per metre). */
    bank: number;
    /** Bumps on the ground (m). */
    bumps: number;
    /** Hills lying across the road's way. */
    ridges: RidgeDef;
  };
  colors: {
    grass: string;
    grass2: string;
    grass3: string;
    rock: string;
    sand: string;
    snow: string;
    verge: string;
    /** Layers in the rock, by height (desert). */
    strata?: string[];
    strataHeight?: number;
    /** Snow from this height (m). */
    snowLine: number;
    /** Slopes steeper than this show bare rock. */
    rockFrom: number;
    water: string;
    waterDeep: string;
  };
  flora: {
    /** One candidate per this many metres each way. */
    spacing: number;
    /** Nothing tall closer to the road edge than this (m). */
    clear: number;
    /** Size of the woods and clearings (m), and how much of the land they cover (0-1). */
    woods: number;
    cover: number;
    /** No trees above this height (m). */
    treeLine: number;
    plants: PlantDef[];
    /** Small things close to the road. */
    detail: PlantDef[];
    detailSpacing: number;
  };
  air: {
    /** Haze: thicker hides the distance sooner. */
    haze: number;
    /** Tint of the haze and sky, and how strongly (0-1). */
    tint: string;
    tintShare: number;
    clouds: number;
    /** Falling things round the camera (snow, leaves, dust). */
    motes?: { count: number; color: string; size: number; fall: number; drift: number };
  };
}

const MEADOW: Biome = {
  id: 'meadow',
  name: 'Green Hills',
  blurb: 'Rolling farmland, fenced hills and winding lanes between the fields.',
  card: ['#a8d4f2', '#7fa36a', '#6aa84a', '#3d3f42'],
  time: 'day',
  road: { straight: [150, 650], radius: [130, 520], angle: [25, 85], esses: 0.55, grade: 0.08, hairpin: [38, 58], leg: [130, 240], fence: { kind: 'wood', color: '#7a5a3a', hillFrom: 14 }, asphalt: '#3d3f42', shoulder: '#8b8468', line: '#e8e8e0', centre: '#e8e8e0', post: '#f2f2ec', postTop: '#20242a' },
  land: {
    base: 90,
    hills: { amp: 75, scale: 2600 },
    roll: { amp: 9, scale: 460 },
    mountains: { amp: 420, scale: 3400, near: 1200, far: 2600, rise: 1800 },
    bank: 0.42,
    bumps: 0.5,
    ridges: { every: 2300, hill: { height: [28, 62], width: [350, 620] }, climbs: 0.35, climb: { height: [75, 125], width: [560, 820] } },
  },
  colors: { grass: '#5e9c3a', grass2: '#7dad45', grass3: '#a9b955', rock: '#8a8a78', sand: '#b4a878', snow: '#f4f6f8', verge: '#88a257', snowLine: 9000, rockFrom: 1.1, water: '#4d8fb5', waterDeep: '#2a5f85' },
  flora: {
    spacing: 26,
    clear: 9,
    woods: 620,
    cover: 0.42,
    treeLine: 9000,
    plants: [
      { kind: 'broadleaf', weight: 6, size: [9, 19], tints: ['#3f7a2e', '#4d8a33', '#35702f', '#5b9438'] },
      { kind: 'poplar', weight: 1, size: [15, 24], tints: ['#3d7530', '#4b8537'] },
      { kind: 'shrub', weight: 3, size: [1.2, 3], tints: ['#4b8034', '#64923f'] },
    ],
    detail: [
      { kind: 'tuft', weight: 8, size: [0.35, 0.8], tints: ['#6fa53f', '#8ab54c', '#a8bb58'] },
      { kind: 'flower', weight: 4, size: [0.3, 0.55], tints: ['#f2e24a', '#ffffff', '#e8567a', '#b070e8'] },
    ],
    detailSpacing: 5,
  },
  air: { haze: 0.00012, tint: '#dcebf5', tintShare: 0, clouds: 0.5, motes: { count: 160, color: '#fff8d8', size: 0.07, fall: 0.15, drift: 1.2 } },
};

const ALPINE: Biome = {
  id: 'alpine',
  name: 'Alpine Pass',
  blurb: 'Hairpins up the mountainside, pines, snowy peaks and a lake or two.',
  card: ['#8ec5ee', '#8b98a8', '#3f6b45', '#3a3c40'],
  time: 'day',
  road: { straight: [60, 280], radius: [65, 240], angle: [35, 105], esses: 0.7, grade: 0.09, hairpin: [30, 42], leg: [190, 340], fence: { kind: 'rail', color: '#a9afb4', hillFrom: 30 }, asphalt: '#3a3c40', shoulder: '#7d7a70', line: '#e8e8e0', centre: '#e8e8e0', post: '#f2f2ec', postTop: '#d12f2f' },
  land: {
    base: 150,
    hills: { amp: 110, scale: 2400 },
    roll: { amp: 12, scale: 330 },
    mountains: { amp: 1700, scale: 3400, near: 240, far: 900, rise: 1700 },
    lakes: { scale: 2200, depth: 230, threshold: 0.28 },
    bank: 0.62,
    bumps: 0.5,
    ridges: { every: 2500, hill: { height: [30, 70], width: [350, 560] }, climbs: 0.8, climb: { height: [170, 290], width: [820, 1150] } },
  },
  colors: { grass: '#4f8a3a', grass2: '#3c7434', grass3: '#7d9a46', rock: '#807d7a', sand: '#9c9078', snow: '#f6f8fb', verge: '#748c50', snowLine: 520, rockFrom: 0.78, water: '#3f8ba8', waterDeep: '#1e5470' },
  flora: {
    spacing: 15,
    clear: 12,
    woods: 420,
    cover: 0.62,
    treeLine: 500,
    plants: [
      { kind: 'pine', weight: 10, size: [11, 25], tints: ['#23502e', '#2b5c33', '#1e472b', '#356638'] },
      { kind: 'rock', weight: 1, size: [1, 4], tints: ['#7c7d80', '#8d8c88'] },
    ],
    detail: [
      { kind: 'tuft', weight: 7, size: [0.3, 0.6], tints: ['#5f9440', '#7da64a'] },
      { kind: 'stone', weight: 2, size: [0.25, 0.7], tints: ['#85868a', '#6f7074'] },
      { kind: 'flower', weight: 1, size: [0.2, 0.35], tints: ['#ffffff', '#c490f0', '#ffe46a'] },
    ],
    detailSpacing: 6,
  },
  air: { haze: 0.000085, tint: '#d4e6f5', tintShare: 0.1, clouds: 0.42 },
};

const SNOW: Biome = {
  id: 'snow',
  name: 'Frozen North',
  blurb: 'A ploughed road through deep snow, frosted pines and a low sun.',
  card: ['#d8e6f2', '#c6d3e0', '#f2f6fa', '#4a4d52'],
  time: 'golden',
  road: { straight: [120, 480], radius: [90, 320], angle: [28, 90], esses: 0.55, grade: 0.08, hairpin: [34, 50], leg: [150, 290], fence: { kind: 'rail', color: '#7c858c', hillFrom: 24 }, asphalt: '#4a4d52', shoulder: '#cfd6dc', line: '#c4c8c8', centre: '#c4c8c8', post: '#22262a', postTop: '#f07020' },
  land: {
    base: 130,
    hills: { amp: 70, scale: 2200 },
    roll: { amp: 14, scale: 420 },
    mountains: { amp: 620, scale: 3600, near: 500, far: 1500, rise: 1700 },
    lakes: { scale: 2600, depth: 190, threshold: 0.33 },
    bank: 0.48,
    bumps: 0.6,
    ridges: { every: 2800, hill: { height: [25, 58], width: [330, 560] }, climbs: 0.55, climb: { height: [105, 185], width: [660, 920] } },
  },
  colors: { grass: '#f1f5fa', grass2: '#e6edf5', grass3: '#dbe5f0', rock: '#5c6068', sand: '#e6edf5', snow: '#fbfcff', verge: '#e4eaf0', snowLine: -100, rockFrom: 0.8, water: '#b8d4e4', waterDeep: '#9fc2d6' },
  flora: {
    spacing: 18,
    clear: 8,
    woods: 500,
    cover: 0.48,
    treeLine: 700,
    plants: [
      { kind: 'snowPine', weight: 10, size: [8, 21], tints: ['#27463a', '#2f5044', '#223e36'] },
      { kind: 'boulder', weight: 1, size: [1, 3], tints: ['#6a6e78'] },
    ],
    detail: [
      { kind: 'drift', weight: 2, size: [0.25, 0.6], tints: ['#ffffff', '#f4f7fb'] },
      { kind: 'stone', weight: 1, size: [0.2, 0.5], tints: ['#5c6068'] },
    ],
    detailSpacing: 9,
  },
  air: { haze: 0.00017, tint: '#e3ecf5', tintShare: 0.45, clouds: 0.62, motes: { count: 1400, color: '#ffffff', size: 0.075, fall: 1.6, drift: 1.1 } },
};

const DESERT: Biome = {
  id: 'desert',
  name: 'Red Canyon',
  blurb: 'Desert highway over red ridges, past flat-topped rock towers.',
  card: ['#f2c79a', '#b85f38', '#c98a55', '#47423f'],
  time: 'golden',
  road: { straight: [250, 950], radius: [150, 650], angle: [22, 80], esses: 0.45, grade: 0.08, hairpin: [40, 60], leg: [170, 310], fence: { kind: 'wire', color: '#6e5c48', hillFrom: 22 }, asphalt: '#47423f', shoulder: '#b08a60', line: '#e8e2d0', centre: '#e9b53c', post: '#ece4d4', postTop: '#c23a28' },
  land: {
    base: 110,
    hills: { amp: 45, scale: 2800 },
    roll: { amp: 6, scale: 360 },
    mesas: { height: 190, scale: 1500, near: 130 },
    bank: 1.3,
    bumps: 0.35,
    ridges: { every: 3000, hill: { height: [22, 48], width: [340, 600] }, climbs: 0.4, climb: { height: [85, 145], width: [620, 880] } },
  },
  colors: {
    grass: '#c98a55',
    grass2: '#bd7c4b',
    grass3: '#d49e68',
    rock: '#a95a36',
    sand: '#d8a670',
    snow: '#ffffff',
    verge: '#c9986a',
    strata: ['#b4623a', '#c97c4c', '#a2502f', '#d09058', '#b86a3e', '#8e4629'],
    strataHeight: 26,
    snowLine: 9000,
    rockFrom: 0.72,
    water: '#3f8ba8',
    waterDeep: '#1e5470',
  },
  flora: {
    spacing: 34,
    clear: 8,
    woods: 500,
    cover: 0.55,
    treeLine: 9000,
    plants: [
      { kind: 'shrub', weight: 8, size: [0.8, 2], tints: ['#8a8a48', '#9d8f4e', '#74783f'] },
      { kind: 'cactus', weight: 3, size: [3.5, 8], tints: ['#4e7a44', '#5c8a4c'] },
      { kind: 'boulder', weight: 3, size: [1, 5], tints: ['#a95a36', '#8e4629', '#b96e44'] },
    ],
    detail: [
      { kind: 'stone', weight: 5, size: [0.2, 0.55], tints: ['#a0603c', '#8a5236'] },
      { kind: 'tuft', weight: 3, size: [0.3, 0.55], tints: ['#a39a50', '#b0a35a'] },
    ],
    detailSpacing: 8,
  },
  air: { haze: 0.000095, tint: '#f3d8b8', tintShare: 0.3, clouds: 0.18, motes: { count: 180, color: '#f0d0a0', size: 0.06, fall: 0.1, drift: 3 } },
};

const FOREST: Biome = {
  id: 'forest',
  name: 'Autumn Woods',
  blurb: 'Winding through red and gold trees, leaves drifting across the road.',
  card: ['#f4d9a8', '#b8703a', '#c9882e', '#3c3a38'],
  time: 'golden',
  road: { straight: [50, 220], radius: [60, 230], angle: [35, 105], esses: 0.7, grade: 0.085, hairpin: [30, 44], leg: [120, 230], fence: { kind: 'wood', color: '#5e4630', hillFrom: 22 }, asphalt: '#3c3a38', shoulder: '#6e5a40', line: '#dcd8c4', centre: '#dcd8c4', post: '#efeade', postTop: '#20242a' },
  land: {
    base: 130,
    hills: { amp: 95, scale: 1700 },
    roll: { amp: 16, scale: 320 },
    mountains: { amp: 330, scale: 2200, near: 500, far: 1400, rise: 1500 },
    bank: 0.55,
    bumps: 0.6,
    ridges: { every: 2300, hill: { height: [30, 62], width: [300, 520] }, climbs: 0.55, climb: { height: [95, 165], width: [620, 880] } },
  },
  colors: { grass: '#8a7a38', grass2: '#a0702e', grass3: '#7a8a3c', rock: '#6e6458', sand: '#9c8a60', snow: '#f4f6f8', verge: '#94803c', snowLine: 9000, rockFrom: 0.85, water: '#46788a', waterDeep: '#284e60' },
  flora: {
    spacing: 13,
    clear: 8,
    woods: 380,
    cover: 0.75,
    treeLine: 9000,
    plants: [
      { kind: 'broadleaf', weight: 8, size: [10, 22], tints: ['#c9541f', '#e08a1e', '#d9a91f', '#a83c1c', '#7f8a2c', '#e8b923'] },
      { kind: 'birch', weight: 3, size: [11, 19], tints: ['#e8bd2a', '#f0cc38', '#d9a51f'] },
      { kind: 'pine', weight: 2, size: [14, 24], tints: ['#23502e', '#2b5c33'] },
    ],
    detail: [
      { kind: 'tuft', weight: 5, size: [0.3, 0.6], tints: ['#a58a3a', '#8f8a3c', '#b8892e'] },
      { kind: 'flower', weight: 3, size: [0.12, 0.2], tints: ['#d9581f', '#e8a51f', '#b8341c'] },
    ],
    detailSpacing: 6,
  },
  air: { haze: 0.00021, tint: '#f2dcb4', tintShare: 0.35, clouds: 0.4, motes: { count: 420, color: '#e8982c', size: 0.14, fall: 1, drift: 2.2 } },
};

const COAST: Biome = {
  id: 'coast',
  name: 'Sunset Coast',
  blurb: 'A cliff road with the ocean on your right, all the way to the sun.',
  card: ['#f5a26b', '#c76d6a', '#3f7f96', '#3f3f42'],
  time: 'dusk',
  road: { straight: [100, 420], radius: [80, 300], angle: [28, 90], esses: 0.6, grade: 0.08, hairpin: [32, 46], leg: [130, 250], fence: { kind: 'rail', color: '#d8d6cc', hillFrom: 18 }, asphalt: '#3f3f42', shoulder: '#a39a7c', line: '#ecebe2', centre: '#ecebe2', post: '#f2f2ec', postTop: '#d12f2f' },
  land: {
    base: 62,
    hills: { amp: 22, scale: 1800 },
    roll: { amp: 5, scale: 300 },
    mountains: { amp: 430, scale: 2600, near: 500, far: 1300, rise: 1500 },
    sea: { near: 12, far: 90, width: 240 },
    bank: 0.9,
    bumps: 0.4,
    ridges: { every: 2600, hill: { height: [16, 42], width: [300, 520] }, climbs: 0.6, climb: { height: [95, 155], width: [620, 880] } },
  },
  colors: { grass: '#6c9a48', grass2: '#88a653', grass3: '#a3ad5e', rock: '#8c7a66', sand: '#e0c896', snow: '#f4f6f8', verge: '#94a460', snowLine: 9000, rockFrom: 0.68, water: '#1f7fa8', waterDeep: '#0e4a70' },
  flora: {
    spacing: 28,
    clear: 8,
    woods: 420,
    cover: 0.55,
    treeLine: 9000,
    plants: [
      { kind: 'palm', weight: 5, size: [9, 17], tints: ['#3d7a3a', '#4c8a3e', '#5b9440'] },
      { kind: 'shrub', weight: 6, size: [1, 2.6], tints: ['#5a8a42', '#74983f'] },
      { kind: 'rock', weight: 2, size: [1, 3.5], tints: ['#8c7a66', '#a08c74'] },
    ],
    detail: [
      { kind: 'tuft', weight: 6, size: [0.3, 0.7], tints: ['#8aa84c', '#a8b45a'] },
      { kind: 'flower', weight: 1, size: [0.2, 0.35], tints: ['#ffffff', '#ffdf60'] },
    ],
    detailSpacing: 7,
  },
  air: { haze: 0.00011, tint: '#f7cfa8', tintShare: 0.28, clouds: 0.45 },
};

export const BIOMES: Biome[] = [MEADOW, ALPINE, SNOW, DESERT, FOREST, COAST];

/** What's picked in the menu: one landscape, or all of them one after another. */
export interface OpenRoadMap {
  id: string;
  name: string;
  blurb: string;
  card: [string, string, string, string];
  /** Biomes in order; with more than one the land changes as you drive. */
  biomes: Biome[];
}

export const JOURNEY_ID = 'journey';

export const OPEN_ROAD_MAPS: OpenRoadMap[] = [
  { id: JOURNEY_ID, name: 'The Long Way', blurb: 'All of them, one after another: the land changes as you drive.', card: ['#a8d4f2', '#c98a55', '#f2f6fa', '#3d3f42'], biomes: [MEADOW, FOREST, ALPINE, SNOW, COAST, DESERT] },
  ...BIOMES.map((b) => ({ id: b.id, name: b.name, blurb: b.blurb, card: b.card, biomes: [b] })),
];

export function openRoadMap(id: string): OpenRoadMap {
  return OPEN_ROAD_MAPS.find((m) => m.id === id) ?? OPEN_ROAD_MAPS[0];
}
