import type { TrackDef } from './types';

/**
 * Full length: a circuit at its real size. Tracks are built scaled down (mostly half size, see
 * `TrackDef.scale`) so laps are short; time trial can scale one back up. The width stays the
 * game's (keyboard steering needs the room), so only the lap gets longer: real straights, real
 * corner radii. Each length has its own leaderboard, ghosts and medals (`lengthKey`).
 */

/** Added to a track id for its full length board key (`silverstone~full`, then `@gt3` for a class). */
export const FULL_SUFFIX = '~full';

/** How much bigger the full length circuit is (1 = already real size, e.g. Monaco). */
export function fullFactor(def: TrackDef): number {
  return def.scale && def.scale < 1 ? 1 / def.scale : 1;
}

/** The track has a full length that differs from the normal one. */
export function hasFullLength(def: TrackDef | undefined): boolean {
  return !!def && fullFactor(def) > 1;
}

/**
 * The circuit at real size: the centreline, DRS zones, pit lane and hills all scaled up (heights
 * too: they were scaled like the track to keep real gradients). Width and scenery stay; landmarks
 * are placed by share of the lap, so they still land in the right place.
 */
export function fullLengthDef(def: TrackDef): TrackDef {
  const k = fullFactor(def);
  if (k === 1) return def;
  const out: TrackDef = { ...def, scale: 1, points: def.points.map(([x, y]) => [x * k, y * k]) };
  if (def.drsZones) out.drsZones = def.drsZones.map((z) => ({ detect: z.detect * k, start: z.start * k, end: z.end * k }));
  if (def.pit) {
    out.pit = { ...def.pit };
    if (def.pit.from !== undefined && def.pit.to !== undefined) Object.assign(out.pit, { from: def.pit.from * k, to: def.pit.to * k });
  }
  if (def.elevation) out.elevation = { step: def.elevation.step * k, heights: def.elevation.heights.map((h) => h * k) };
  return out;
}

/** The track id laps are kept under for this length (the plain id when full length is the same track). */
export function lengthKey(id: string, def: TrackDef | undefined, full: boolean): string {
  return full && hasFullLength(def) ? `${id}${FULL_SUFFIX}` : id;
}

/** A board key's track part split into the track id and whether it is full length. */
export function parseLengthKey(track: string): { id: string; full: boolean } {
  return track.endsWith(FULL_SUFFIX) ? { id: track.slice(0, -FULL_SUFFIX.length), full: true } : { id: track, full: false };
}
