import { COMPOUNDS } from '../sim/tyres';
import type { SessionEvent } from '../sim/session';
import { formatLapTime, type Toast } from './hud';

/** Turn a race event for the local driver into a short on-screen message. */
export function eventToast(e: SessionEvent, now: number): Toast | null {
  const until = now + 3;
  switch (e.kind) {
    case 'lap': {
      const text = `${e.personalBest ? 'PERSONAL BEST  ' : ''}${formatLapTime(e.lap.time)}${e.lap.valid ? '' : '  (deleted)'}`;
      return { text, color: e.personalBest ? '#b84dff' : e.lap.valid ? '#ffffff' : '#888', until };
    }
    case 'trackLimits': {
      // In races only every 20th warning costs time (+5 s), so show the count towards it.
      const count = `${((e.warnings - 1) % 20) + 1}/20`;
      const text = e.lapDeleted ? `TRACK LIMITS ${count}: LAP TIME DELETED` : `TRACK LIMITS ${count}`;
      return { text, color: '#ffb347', until };
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
      if (e.verdict === 'theirFault') return { text: `${e.other} hit you${e.warning ? ': they get a warning' : ": they're penalised"}`, color: '#cccccc', until };
      if (e.warning) return { text: `WARNING: careful with ${e.other} (next time is a penalty)`, color: '#ffb347', until: now + 4 };
      return null;
    case 'reset':
      return { text: e.note.toUpperCase(), color: '#ffffff', until };
    case 'penalty':
      return { text: `+${e.penalty.seconds}s PENALTY: ${e.penalty.reason}`, color: '#ff4136', until: now + 5 };
  }
}
