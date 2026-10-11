/**
 * Car paint schemes. A player's car colour (handed out in the lobby) stays their identity
 * on the minimap and name tags; each one is painted as a team-inspired livery. Colours
 * and shapes only: no team names, logos or sponsors.
 */
export interface Livery {
  /** Main body colour. */
  body: string;
  /** Front of the car (nose to cockpit) in another colour, e.g. silver over black. */
  front?: string;
  /** Sidepods in another colour. */
  pods?: string;
  /** A stripe down the middle of the car. */
  stripe?: string;
  /** A swoosh along each sidepod. */
  flash?: string;
  /** Nose tip. */
  nose: string;
  /** Front and rear wing main planes. */
  wings: string;
  /** Wing endplates. */
  endplates: string;
  /** Driver's helmet. */
  helmet: string;
}

const LIVERIES: Record<string, Livery> = {
  // Scarlet with white swooshes and black wings.
  '#e10600': { body: '#d40000', flash: '#ffffff', nose: '#d40000', wings: '#1a1a1a', endplates: '#d40000', helmet: '#ffd400' },
  // Navy with bright blue sidepods and a cyan stripe.
  '#1e5bff': { body: '#0b1f5e', pods: '#1e5bff', stripe: '#29c6ff', nose: '#29c6ff', wings: '#0b1f5e', endplates: '#1e5bff', helmet: '#ffffff' },
  // Papaya with anthracite sidepods and blue details.
  '#ff8700': { body: '#ff8700', pods: '#262626', nose: '#ff8700', wings: '#262626', endplates: '#ff8700', helmet: '#1e90ff' },
  // Silver front, black rear, teal stripe.
  '#00d2be': { body: '#141414', front: '#bfc4c8', stripe: '#00d2be', nose: '#00d2be', wings: '#141414', endplates: '#00d2be', helmet: '#eeeeee' },
  // Pink with blue sidepods and wings.
  '#f596c8': { body: '#f596c8', pods: '#1f6fd6', nose: '#f596c8', wings: '#1f6fd6', endplates: '#f596c8', helmet: '#ffffff' },
  // Black with neon green sidepods and nose.
  '#52e252': { body: '#161616', pods: '#52e252', stripe: '#52e252', nose: '#52e252', wings: '#161616', endplates: '#52e252', helmet: '#52e252' },
  // Sunflower yellow with a black stripe.
  '#ffd400': { body: '#ffd400', stripe: '#141414', nose: '#141414', wings: '#141414', endplates: '#ffd400', helmet: '#e10600' },
  // Violet with white swooshes.
  '#b06cff': { body: '#8a3ff0', flash: '#ffffff', nose: '#ffffff', wings: '#2a1450', endplates: '#b06cff', helmet: '#ffd400' },
  // White front, black rear, red stripe.
  '#e8e8e8': { body: '#1a1a1a', front: '#f2f2f2', stripe: '#e10600', nose: '#e10600', wings: '#1a1a1a', endplates: '#f2f2f2', helmet: '#e10600' },
  // Black and gold pinstripes.
  '#8b5a2b': { body: '#111111', stripe: '#c9a227', flash: '#c9a227', nose: '#c9a227', wings: '#111111', endplates: '#c9a227', helmet: '#c9a227' },
};

/** The livery for a car colour; unknown colours get a plain scheme in that colour. */
export function liveryFor(color: string): Livery {
  return (
    LIVERIES[color.toLowerCase()] ?? {
      body: color,
      stripe: '#ffffff',
      nose: color,
      wings: '#1a1a1a',
      endplates: color,
      helmet: '#ffffff',
    }
  );
}
