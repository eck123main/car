import { parseTrackDef } from '../track/io';
import type { TrackDef } from '../track/types';
import albertPark from './albert-park.json';
import bahrain from './bahrain.json';
import baku from './baku.json';
import barcelona from './barcelona.json';
import cota from './cota.json';
import hungaroring from './hungaroring.json';
import interlagos from './interlagos.json';
import jeddah from './jeddah.json';
import lasVegas from './las-vegas.json';
import lusail from './lusail.json';
import madrid from './madrid.json';
import mexico from './mexico.json';
import miami from './miami.json';
import monaco from './monaco.json';
import montreal from './montreal.json';
import monza from './monza.json';
import redBullRing from './red-bull-ring.json';
import shanghai from './shanghai.json';
import silverstone from './silverstone.json';
import singapore from './singapore.json';
import spa from './spa.json';
import suzuka from './suzuka.json';
import testCircuit from './test-circuit.json';
import yasMarina from './yas-marina.json';
import zandvoort from './zandvoort.json';

/** Built-in tracks, by id, in the order of the 2026 F1 calendar (plus the test circuit). */
export const TRACKS: Record<string, TrackDef> = {
  'albert-park': parseTrackDef(albertPark),
  shanghai: parseTrackDef(shanghai),
  suzuka: parseTrackDef(suzuka),
  bahrain: parseTrackDef(bahrain),
  jeddah: parseTrackDef(jeddah),
  miami: parseTrackDef(miami),
  montreal: parseTrackDef(montreal),
  monaco: parseTrackDef(monaco),
  barcelona: parseTrackDef(barcelona),
  'red-bull-ring': parseTrackDef(redBullRing),
  silverstone: parseTrackDef(silverstone),
  spa: parseTrackDef(spa),
  hungaroring: parseTrackDef(hungaroring),
  zandvoort: parseTrackDef(zandvoort),
  monza: parseTrackDef(monza),
  madrid: parseTrackDef(madrid),
  baku: parseTrackDef(baku),
  singapore: parseTrackDef(singapore),
  cota: parseTrackDef(cota),
  mexico: parseTrackDef(mexico),
  interlagos: parseTrackDef(interlagos),
  'las-vegas': parseTrackDef(lasVegas),
  lusail: parseTrackDef(lusail),
  'yas-marina': parseTrackDef(yasMarina),
  test: parseTrackDef(testCircuit),
};

/** Every real circuit (everything but the test circuit). */
export const REAL_TRACK_IDS = Object.keys(TRACKS).filter((id) => id !== 'test');

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
