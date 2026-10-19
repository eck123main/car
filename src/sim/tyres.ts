export type Compound = 'soft' | 'medium' | 'hard' | 'inter' | 'wet';

export const DRY_COMPOUNDS: Compound[] = ['soft', 'medium', 'hard'];
export const ALL_COMPOUNDS: Compound[] = ['soft', 'medium', 'hard', 'inter', 'wet'];

export interface CompoundInfo {
  name: string;
  letter: string;
  color: string;
  /** Grip multiplier on a fully dry and a fully wet track. */
  dryGrip: number;
  wetGrip: number;
  /** Laps to the cliff at least, whatever the race length. */
  minLaps: number;
  /** Laps to the cliff as a share of the race distance (when longer than minLaps). */
  raceShare: number;
}

export const COMPOUNDS: Record<Compound, CompoundInfo> = {
  soft: { name: 'Soft', letter: 'S', color: '#e10600', dryGrip: 1.025, wetGrip: 0.55, minLaps: 4, raceShare: 0.5 },
  medium: { name: 'Medium', letter: 'M', color: '#ffd400', dryGrip: 1.0, wetGrip: 0.55, minLaps: 6, raceShare: 0.75 },
  hard: { name: 'Hard', letter: 'H', color: '#f0f0f0', dryGrip: 0.975, wetGrip: 0.55, minLaps: 9, raceShare: 1.1 },
  inter: { name: 'Intermediate', letter: 'I', color: '#2ecc40', dryGrip: 0.86, wetGrip: 0.85, minLaps: 6, raceShare: 0.8 },
  wet: { name: 'Wet', letter: 'W', color: '#1e90ff', dryGrip: 0.78, wetGrip: 0.95, minLaps: 7.5, raceShare: 1 },
};

/** Wear where grip falls off sharply (the cliff). */
export const CLIFF = 0.75;

/**
 * Laps a set lasts before the cliff: a share of the race (so a short race and a long one both
 * have a strategy), never under the compound's minimum (so tyres never die in a lap or two).
 * `raceLaps` null = not a race (practice, qualifying). With wear off, they last forever.
 */
export function tyreLife(compound: Compound, raceLaps: number | null, wear = true): number {
  if (!wear) return Infinity;
  const c = COMPOUNDS[compound];
  return Math.max(c.minLaps, (raceLaps ?? 0) * c.raceShare);
}

/** Average share of grip in use on a lap at the limit: wears at exactly the listed life. */
export const PUSHING_LOAD = 5 / 6;

/** A set of tyres on a car. Wear goes 0 (new) to 1 (finished). */
export class Tyres {
  wear = 0;

  constructor(public compound: Compound) {}

  /**
   * Grip multiplier for the current wear and track wetness (0 = dry, 1 = soaked).
   * Wear costs a little grip gradually, then a lot past ~75% (the "cliff").
   */
  grip(wetness: number): number {
    const c = COMPOUNDS[this.compound];
    const base = c.dryGrip + (c.wetGrip - c.dryGrip) * wetness;
    const loss = this.wear < 0.75 ? 0.12 * this.wear : 0.09 + (this.wear - 0.75) * 1.0;
    return base * (1 - Math.min(loss, 0.35));
  }

  /**
   * Wear the tyres for `distance` metres driven, for a set that lasts `life` laps to the cliff.
   * Pushing at the limit (`load`, the share of grip in use, ~0.8 on average) wears them at that
   * rate, so the life shown is what a fast driver gets. Gentle driving saves up to 25%;
   * sliding and running off the track cost a little more, at most 1.5x in all.
   */
  update(distance: number, trackLength: number, wetness: number, load = PUSHING_LOAD, sliding = false, offTrack = false, life = tyreLife(this.compound, null)): void {
    if (!Number.isFinite(life)) return;
    const l = Math.min(Math.max(load, 0), 1.2);
    let rate = Math.min(1.5, 0.75 + 0.3 * l + (sliding ? 0.25 : 0) + (offTrack ? 0.15 : 0));
    // Rain tyres overheat and wear fast on a drying track.
    if ((this.compound === 'inter' || this.compound === 'wet') && wetness < 0.3) rate *= 2;
    this.wear = Math.min(1, this.wear + (distance / ((life / CLIFF) * trackLength)) * rate);
  }
}
