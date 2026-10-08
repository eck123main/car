/** Track file format (JSON). All distances are in metres. */
export interface TrackDef {
  name: string;
  /** Full track width in metres. */
  width: number;
  /** Closed centreline control points [x, y], in driving order. The first point is the start/finish line. */
  points: [number, number][];
}

export type SurfaceType = 'asphalt' | 'kerb' | 'grass' | 'gravel' | 'wall';

export interface Surface {
  type: SurfaceType;
  /** Grip multiplier relative to dry asphalt. */
  grip: number;
  /** Extra rolling drag as a deceleration in m/s^2. */
  drag: number;
}

export const SURFACES: Record<SurfaceType, Surface> = {
  asphalt: { type: 'asphalt', grip: 1, drag: 0 },
  kerb: { type: 'kerb', grip: 0.95, drag: 0.2 },
  grass: { type: 'grass', grip: 0.7, drag: 1.5 },
  gravel: { type: 'gravel', grip: 0.6, drag: 3.5 },
  wall: { type: 'wall', grip: 0.4, drag: 4 },
};
