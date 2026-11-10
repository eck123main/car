import { F1_CAR, GT3_CAR, type CarParams } from '../physics/carParams';

/**
 * Kinds of car. Each one is its own category in time trial (own leaderboard, ghosts and medals):
 * an F1 lap and a GT3 lap are never compared.
 */
export type CarClassId = 'f1' | 'gt3';

export interface CarClass {
  id: CarClassId;
  name: string;
  /** One line for the menu. */
  blurb: string;
  params: CarParams;
  /** Has a DRS flap / an ERS battery (GT3 cars have neither). */
  drs: boolean;
  ers: boolean;
}

export const CAR_CLASSES: Record<CarClassId, CarClass> = {
  f1: {
    id: 'f1',
    name: 'F1',
    blurb: 'Huge downforce, brakes impossibly late, DRS and ERS.',
    params: F1_CAR,
    drs: true,
    ers: true,
  },
  gt3: {
    id: 'gt3',
    name: 'GT3',
    blurb: 'Heavy and wide, far less downforce: brake early, carry speed through the slow corners. No DRS, no ERS.',
    params: GT3_CAR,
    drs: false,
    ers: false,
  },
};

export const CAR_CLASS_ORDER: CarClassId[] = ['f1', 'gt3'];

export function isCarClassId(v: unknown): v is CarClassId {
  return typeof v === 'string' && v in CAR_CLASSES;
}

/**
 * Where a track's time trial laps are kept for a class: F1 keeps the plain track id (every lap
 * set before classes existed is F1), other classes add `@class`.
 */
export function boardKey(track: string, cls: CarClassId): string {
  return cls === 'f1' ? track : `${track}@${cls}`;
}

/** The track and class a leaderboard key is for. */
export function parseBoardKey(key: string): { track: string; cls: CarClassId } {
  const at = key.lastIndexOf('@');
  if (at < 0) return { track: key, cls: 'f1' };
  const cls = key.slice(at + 1);
  return { track: key.slice(0, at), cls: isCarClassId(cls) ? cls : 'f1' };
}
