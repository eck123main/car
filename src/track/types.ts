/** Track file format (JSON). All distances are in metres. */
export interface TrackDef {
  name: string;
  /** Full track width in metres. */
  width: number;
  /** Closed centreline control points [x, y], in driving order. The first point is the start/finish line. */
  points: [number, number][];
  /** Optional DRS zones; found automatically on the longest straights when missing. */
  drsZones?: DrsZone[];
  /** Which side of the start/finish straight the pit lane is on (as at the real circuit). */
  pit?: PitDef;
  /** What makes the circuit recognisable in the 3D view. Looks only: never changes the physics. */
  scenery?: SceneryDef;
  /** Real terrain heights (m) every `step` m of the lap from the start line (scripts/elevation.ts). */
  elevation?: ElevationDef;
}

export interface ElevationDef {
  step: number;
  heights: number[];
}

/** Compass direction (north is up on the map). */
export type Compass = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW';

/**
 * The look of a circuit in 3D, and its landmarks. Landmarks are placed by share of the lap
 * (0..1 from the start line) and side ('left' / 'right' of the driving direction).
 */
export interface SceneryDef {
  /** Night race (floodlights) or a sunset race. Default: day. */
  sky?: 'day' | 'dusk' | 'night';
  /** Desert (sand, few trees), dunes (sandy grass) or forest (more trees). Default: green. */
  land?: 'green' | 'desert' | 'dunes' | 'forest';
  /** Taller mountains round the horizon (e.g. the Alps). */
  alps?: boolean;
  /** A big mountain on the horizon in this direction (Mount Fuji). */
  mountain?: Compass;
  /** Sea beyond the circuit in this direction. */
  sea?: Compass;
  /** Tall city buildings round the circuit. */
  city?: boolean;
  landmarks?: Landmark[];
}

export type LandmarkType =
  /** Roof over the track from `from` to `to` (Monaco). */
  | 'tunnel'
  /** Water beside the track from `from` to `to`, `gap` m past the wall, `width` m wide; `boats`. */
  | 'water'
  /** Where the track crosses itself, the later stretch goes over a bridge (Suzuka). */
  | 'crossover'
  /** A building spanning the track at `at` (Yas Marina hotel). */
  | 'hotel'
  /** Big wheel at `at`, `gap` m past the wall, `size` = radius. */
  | 'wheel'
  /** A huge glowing sphere (Las Vegas), `size` = radius. */
  | 'sphere'
  /** Three flame-shaped towers (Baku). */
  | 'flames'
  /** Three towers with a ship-like park on top (Marina Bay Sands). */
  | 'sands'
  /** Old stone city walls with towers along the track from `from` to `to` (Baku). */
  | 'walls'
  /** Tall buildings along the track from `from` to `to` (the Las Vegas Strip). */
  | 'strip'
  /** Stadium stands on both sides from `from` to `to` (Mexico's Foro Sol). */
  | 'stadium'
  /** Words painted on the wall at `at` (the Wall of Champions). */
  | 'sign';

export interface Landmark {
  type: LandmarkType;
  at?: number;
  from?: number;
  to?: number;
  side?: 'left' | 'right';
  /** Distance past the wall (m). */
  gap?: number;
  width?: number;
  size?: number;
  text?: string;
  boats?: boolean;
}

export interface PitDef {
  side: 'left' | 'right';
  /**
   * Optional lap distances (m, negative = before the start line) where the lane starts and
   * ends. Without them the lane follows the start/finish straight. Needed for circuits like
   * Monaco whose pit lane runs round corners.
   */
  from?: number;
  to?: number;
}

/** Distances along the lap (m) from the start line. */
export interface DrsZone {
  /** Gap to the car ahead is measured here. */
  detect: number;
  /** DRS can be opened between start and end. */
  start: number;
  end: number;
}

export type SurfaceType = 'asphalt' | 'kerb' | 'grass' | 'gravel' | 'wall' | 'pit';

export interface Surface {
  type: SurfaceType;
  /** Grip multiplier relative to dry asphalt. */
  grip: number;
  /** Extra rolling drag as a deceleration in m/s^2. */
  drag: number;
  /** Extra drag that grows with speed (deceleration per m/s), so going off is never faster. */
  dragPerSpeed: number;
}

export const SURFACES: Record<SurfaceType, Surface> = {
  asphalt: { type: 'asphalt', grip: 1, drag: 0, dragPerSpeed: 0 },
  kerb: { type: 'kerb', grip: 0.95, drag: 0.2, dragPerSpeed: 0 },
  grass: { type: 'grass', grip: 0.7, drag: 1.5, dragPerSpeed: 0.33 },
  gravel: { type: 'gravel', grip: 0.6, drag: 3.5, dragPerSpeed: 0.6 },
  wall: { type: 'wall', grip: 0.4, drag: 4, dragPerSpeed: 0.4 },
  pit: { type: 'pit', grip: 1, drag: 0, dragPerSpeed: 0 },
};
