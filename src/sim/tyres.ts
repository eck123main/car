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
  /** Laps until fully worn (scaled to each track's length). */
  lifeLaps: number;
}

export const COMPOUNDS: Record<Compound, CompoundInfo> = {
  soft: { name: 'Soft', letter: 'S', color: '#e10600', dryGrip: 1.05, wetGrip: 0.55, lifeLaps: 4 },
  medium: { name: 'Medium', letter: 'M', color: '#ffd400', dryGrip: 1.0, wetGrip: 0.55, lifeLaps: 7 },
  hard: { name: 'Hard', letter: 'H', color: '#f0f0f0', dryGrip: 0.95, wetGrip: 0.55, lifeLaps: 11 },
  inter: { name: 'Intermediate', letter: 'I', color: '#2ecc40', dryGrip: 0.86, wetGrip: 0.85, lifeLaps: 8 },
  wet: { name: 'Wet', letter: 'W', color: '#1e90ff', dryGrip: 0.78, wetGrip: 0.95, lifeLaps: 10 },
};

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

  /** Wear the tyres for `distance` metres driven. */
  update(distance: number, trackLength: number, wetness: number): void {
    const c = COMPOUNDS[this.compound];
    let rate = 1;
    // Rain tyres overheat and wear fast on a drying track.
    if ((this.compound === 'inter' || this.compound === 'wet') && wetness < 0.3) rate = 2;
    this.wear = Math.min(1, this.wear + (distance / (c.lifeLaps * trackLength)) * rate);
  }
}
