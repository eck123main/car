/** Player preferences, kept in this browser. */
export interface Settings {
  /** All game sound. */
  sound: boolean;
  /** Master volume, 0..1. */
  volume: number;
  /** Engine, wind and tyre noise. Off by default until the engine sound is better. */
  engine: boolean;
  /** DRS, ERS, start lights and other beeps. */
  effects: boolean;
  /** The big live delta, top centre. */
  delta: boolean;
}

const KEY = 'f1td.settings';
/** Saved settings older than this still have the engine on from when it was the default. */
const VERSION = 2;

export const DEFAULT_SETTINGS: Settings = { sound: true, volume: 0.6, engine: false, effects: true, delta: true };

let current: Settings = load();
const listeners = new Set<(s: Settings) => void>();

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Partial<Settings> & { version?: number };
      if ((saved.version ?? 1) < VERSION) delete saved.engine;
      delete saved.version;
      return { ...DEFAULT_SETTINGS, ...saved };
    }
  } catch {
    // Blocked or broken storage: defaults.
  }
  return { ...DEFAULT_SETTINGS };
}

export function settings(): Readonly<Settings> {
  return current;
}

export function updateSettings(changes: Partial<Settings>): void {
  current = { ...current, ...changes };
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...current, version: VERSION }));
  } catch {
    // Not remembered next time, but still applied now.
  }
  for (const l of listeners) l(current);
}

/** Call `fn` whenever the settings change. Returns a function that stops listening. */
export function onSettings(fn: (s: Settings) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
