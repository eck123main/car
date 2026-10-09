import { parseTrackDef } from '../track/io';
import type { TrackDef } from '../track/types';
import albertPark from './albert-park.json';
import bahrain from './bahrain.json';
import baku from './baku.json';
import cota from './cota.json';
import monaco from './monaco.json';
import silverstone from './silverstone.json';
import spa from './spa.json';
import testCircuit from './test-circuit.json';
import yasMarina from './yas-marina.json';

/** Built-in tracks, by id. */
export const TRACKS: Record<string, TrackDef> = {
  silverstone: parseTrackDef(silverstone),
  bahrain: parseTrackDef(bahrain),
  'albert-park': parseTrackDef(albertPark),
  monaco: parseTrackDef(monaco),
  cota: parseTrackDef(cota),
  spa: parseTrackDef(spa),
  baku: parseTrackDef(baku),
  'yas-marina': parseTrackDef(yasMarina),
  test: parseTrackDef(testCircuit),
};

export const DEFAULT_TRACK = 'silverstone';

/** localStorage key the editor saves to; the game loads it with ?track=custom. */
export const CUSTOM_TRACK_KEY = 'f1td.customTrack';

export function loadCustomTrack(): TrackDef | null {
  try {
    const raw = localStorage.getItem(CUSTOM_TRACK_KEY);
    return raw ? parseTrackDef(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}
