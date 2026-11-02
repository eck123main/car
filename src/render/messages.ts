import { COMPOUNDS } from '../sim/tyres';
import type { SessionEvent } from '../sim/session';
import { formatLapTime, type Toast } from './hud';
import type { DebrisKind } from '../sim/debris';

const DEBRIS_NAMES: Record<DebrisKind, string> = { frontWing: 'FRONT WING', rearWing: 'REAR WING', wheel: 'WHEEL', shard: 'CARBON' };

/** A few characters for the 3D steering wheel's display, for the events worth flashing there. */
export function wheelNote(e: SessionEvent): { text: string; color: string } | null {
  switch (e.kind) {
    case 'penalty':
      return { text: `+${e.penalty.seconds}s`, color: '#ff5a4d' };
    case 'safetyCar':
      if (e.state === 'deployed') return { text: 'SC', color: '#ffd400' };
      if (e.state === 'inThisLap') return { text: 'SC IN', color: '#ffd400' };
      if (e.state === 'green') return { text: 'GREEN', color: '#3ce06a' };
      return null;
    case 'lap':
      return e.personalBest ? { text: 'PB', color: '#b84dff' } : null;
    case 'pitEntry':
      return { text: 'PIT', color: '#4dd2ff' };
    default:
      return null;
  }
}

/** What the engineer says over the radio as a lap ends, shown on the wheel. */
export function radioLine(s: { position: number; gapAhead: number | null; gapBehind: number | null; lapsLeft: number; wear: number }): string {
  if (s.lapsLeft === 1) return 'LAST LAP';
  if (s.lapsLeft === 2) return '2 TO GO';
  if (s.gapBehind !== null && s.gapBehind < 1) return 'DEFEND';
  if (s.gapAhead !== null && s.gapAhead < 1) return 'ATTACK';
  if (s.wear > 0.6) return `TYRES ${Math.round(s.wear * 100)}%`;
  if (s.gapAhead !== null && s.gapAhead < 4) return `GAP ${s.gapAhead.toFixed(1)}`;
  if (s.position === 1) return 'GOOD PACE';
  return `P${s.position} PUSH`;
}

/** Turn a race event for the local driver into a short on-screen message. */
export function eventToast(e: SessionEvent, now: number): Toast | null {
  const until = now + 3;
  switch (e.kind) {
    case 'lap': {
      const text = `${e.personalBest ? 'PERSONAL BEST  ' : ''}${formatLapTime(e.lap.time)}${e.lap.valid ? '' : '  (deleted)'}`;
      return { text, color: e.personalBest ? '#b84dff' : e.lap.valid ? '#ffffff' : '#888', until };
    }
    case 'pitEntry':
      return { text: 'PIT LANE', color: '#ffd400', until };
    case 'pitStop':
      return {
        text: `PIT STOP ${e.duration.toFixed(1)}s · ${COMPOUNDS[e.compound].name}s fitted`,
        color: COMPOUNDS[e.compound].color,
        until: now + 4,
      };
    case 'phase':
      if (e.phase === 'race') return { text: 'LIGHTS OUT!', color: '#2ecc40', until: now + 2.5 };
      if (e.phase === 'grid') return { text: 'TO THE GRID', color: '#ffffff', until };
      return null;
    case 'finished':
      return { text: `FINISHED · P${e.position}`, color: '#ffffff', until: now + 6 };
    case 'contact':
      if (e.verdict === 'incident') return { text: `Contact with ${e.other}: racing incident`, color: '#cccccc', until };
      if (e.verdict === 'theirFault') {
        const why = e.reason ? ` (${e.reason})` : '';
        return { text: `Contact with ${e.other}: their fault${why}${e.warning ? ', warning' : ', penalised'}`, color: '#cccccc', until };
      }
      if (e.warning) {
        const why = e.reason ? `${e.reason}, ` : '';
        return { text: `WARNING: contact with ${e.other} (${why}next time is a penalty)`, color: '#ffb347', until: now + 4 };
      }
      return null;
    case 'debris': {
      const part = DEBRIS_NAMES[e.part];
      if (e.what === 'lost') return { text: `${part} GONE${e.part === 'wheel' ? '' : ' · box for a new one'}`, color: '#ff4136', until: now + 4 };
      return { text: `Hit debris (${part.toLowerCase()})`, color: '#ffb347', until };
    }
    case 'reset':
      return { text: e.note.toUpperCase(), color: '#ffffff', until };
    case 'item':
      return { text: e.text.toUpperCase(), color: '#ff66ff', until: now + 2.5 };
    case 'penalty':
      return { text: `+${e.penalty.seconds}s PENALTY: ${e.penalty.reason}`, color: '#ff4136', until: now + 5 };
    case 'safetyCar':
      if (e.state === 'deployed') return { text: 'SAFETY CAR DEPLOYED · no overtaking · DRS off', color: '#ffb000', until: now + 5 };
      if (e.state === 'inThisLap') return { text: 'SAFETY CAR IN THIS LAP', color: '#ffb000', until: now + 5 };
      if (e.state === 'in') return { text: 'RESTART · no overtaking until the line', color: '#ffb000', until: now + 4 };
      return { text: 'GREEN FLAG · RACE ON!', color: '#2ecc40', until: now + 3 };
  }
}
