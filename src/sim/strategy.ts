import { COMPOUNDS, DRY_COMPOUNDS, type Compound } from './tyres';

/** Pit before the tyres reach the wear cliff (75%), with a little margin. */
const USABLE_LIFE = 0.75;
const WORN = 0.7;
const DAMAGED = 0.3;

export interface StrategyInput {
  /** Race length, or null outside a race (practice / qualifying). */
  laps: number | null;
  /** Lap the car is on now (1 = first lap). */
  currentLap: number;
  /** Does the two-compound rule apply? */
  mandatoryStop: boolean;
  stops: number;
  compoundsUsed: Compound[];
  compound: Compound;
  nextTyre: Compound;
  wear: number;
  damage: number;
  wetness: number;
}

export interface PitAdvice {
  /** Laps (inclusive) in which the mandatory stop makes most sense, if it still applies. */
  window: [number, number] | null;
  /** Worth pitting at the end of this lap. */
  boxNow: boolean;
  reason: string | null;
}

/** A race engineer in a function: when to pit, and why. */
export function pitAdvice(s: StrategyInput): PitAdvice {
  const finalLap = s.laps !== null && s.currentLap >= s.laps;
  const window = mandatoryWindow(s);

  const urgent = urgentReason(s);
  // No point stopping on the last lap, unless the rule still needs it.
  if (urgent && !finalLap) return { window, boxNow: true, reason: urgent };

  if (window) {
    const [first, last] = window;
    // Recommend the middle of the window, then keep reminding until it closes.
    const best = Math.round((first + last) / 2);
    if (s.currentLap >= best && s.currentLap <= last) {
      const reason = s.currentLap === last ? 'Last lap to make your stop' : 'Pit window: box this lap';
      return { window, boxNow: true, reason };
    }
  }
  return { window, boxNow: false, reason: null };
}

function urgentReason(s: StrategyInput): string | null {
  if (s.damage > DAMAGED) return 'Damage: box to repair';
  const rainTyres = s.compound === 'inter' || s.compound === 'wet';
  if (!rainTyres && s.wetness >= 0.4) return 'Track is wet: box for inters or wets';
  if (rainTyres && s.wetness < 0.2) return 'Track is drying: box for slicks';
  if (s.wear > WORN) return 'Tyres are worn: box';
  return null;
}

/** Laps in which to make the one compulsory stop, given how long each set of tyres lasts. */
function mandatoryWindow(s: StrategyInput): [number, number] | null {
  if (!s.mandatoryStop || s.laps === null || s.laps < 2) return null;
  const dryUsed = new Set(s.compoundsUsed.filter((c) => DRY_COMPOUNDS.includes(c)));
  if (s.stops > 0 && dryUsed.size >= 2) return null;

  // The second stint goes on the chosen tyres, or the most durable different compound.
  const next = s.nextTyre !== s.compound && DRY_COMPOUNDS.includes(s.nextTyre) ? s.nextTyre : s.compound === 'hard' ? 'medium' : 'hard';
  const lifeNow = Math.floor(COMPOUNDS[s.compound].lifeLaps * USABLE_LIFE * (1 - s.wear));
  const lifeNext = Math.floor(COMPOUNDS[next].lifeLaps * USABLE_LIFE);
  const lastAllowed = s.laps - 1;
  const latest = Math.min(lastAllowed, s.currentLap - 1 + Math.max(1, lifeNow));
  const earliest = Math.max(1, s.laps - lifeNext);
  if (earliest > latest) return [latest, latest];
  return [earliest, latest];
}

/** A sensible starting tyre for the weather and race length. */
export function recommendedStartTyre(wetness: number, laps: number, mandatoryStop: boolean): Compound {
  if (wetness >= 0.7) return 'wet';
  if (wetness >= 0.35) return 'inter';
  // With a compulsory stop, start on something quick and switch later.
  if (mandatoryStop) return laps <= 6 ? 'soft' : 'medium';
  // No stop needed: the fastest tyre that lasts the whole race.
  return (DRY_COMPOUNDS.find((c) => COMPOUNDS[c].lifeLaps * USABLE_LIFE >= laps) ?? 'hard') as Compound;
}
