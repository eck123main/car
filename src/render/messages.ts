import { COMPOUNDS } from '../sim/tyres';
import type { WorldEvent } from '../sim/world';
import { formatLapTime, type Toast } from './hud';

/** Turn a race event for the local driver into a short on-screen message. */
export function eventToast(e: WorldEvent, now: number): Toast | null {
  const until = now + 3;
  switch (e.kind) {
    case 'lap': {
      const text = `${e.personalBest ? 'PERSONAL BEST  ' : ''}${formatLapTime(e.lap.time)}${e.lap.valid ? '' : '  (deleted)'}`;
      return { text, color: e.personalBest ? '#b84dff' : e.lap.valid ? '#ffffff' : '#888', until };
    }
    case 'trackLimits': {
      const text = e.lapDeleted ? 'TRACK LIMITS: LAP TIME DELETED' : 'TRACK LIMITS';
      return { text: `${text} (warning ${e.warnings})`, color: '#ffb347', until };
    }
    case 'pitEntry':
      return { text: 'PIT LANE', color: '#ffd400', until };
    case 'pitStop':
      return {
        text: `PIT STOP ${e.duration.toFixed(1)}s · ${COMPOUNDS[e.compound].name}s fitted`,
        color: COMPOUNDS[e.compound].color,
        until: now + 4,
      };
    case 'penalty':
      return { text: `+${e.penalty.seconds}s PENALTY: ${e.penalty.reason}`, color: '#ff4136', until: now + 5 };
  }
}
