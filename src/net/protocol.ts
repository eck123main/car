import type { TimerState } from '../game/lapTimer';
import type { PitPhase } from '../sim/pit';
import type { PlayerInfo, QualiEntry, RaceSettings, SessionEvent, SessionPhase, Standing } from '../sim/session';
import type { Compound } from '../sim/tyres';
import type { Penalty, PlayerInput } from '../sim/world';
import type { TrackDef } from '../track/types';

/** Bump when messages change, so mismatched builds refuse to connect. */
export const PROTOCOL_VERSION = 1;
export const MAX_PLAYERS = 10;

export interface LobbyPlayer extends PlayerInfo {
  host: boolean;
}

export interface LobbyState {
  players: LobbyPlayer[];
  settings: RaceSettings;
}

/** Physics and car state, sent ~20 times a second. Short keys keep it small. */
export interface CarSnap {
  id: string;
  x: number;
  y: number;
  h: number;
  vx: number;
  vy: number;
  w: number;
  steer: number;
  thr: number;
  brk: number;
  dmg: number;
  ret: boolean;
  frozen: boolean;
  /** Modifiers the client needs to predict its own car the same way. */
  grip: number;
  drag: number;
  power: number;
  limit: number | null;
  reverse: boolean;
  tyre: Compound;
  wear: number;
  ers: number;
  ersOn: boolean;
  drs: boolean;
  drsOk: boolean;
  tow: number;
  pit: PitPhase;
  pitEnds: number;
  limiter: boolean;
  next: Compound;
  /** Last input sequence number from this car's player that the host has applied. */
  ack: number;
}

export interface TimingSnap extends TimerState {
  id: string;
  delta: number | null;
  penalties: Penalty[];
  compoundsUsed: Compound[];
  stops: number;
}

export interface SessionSnap {
  phase: SessionPhase;
  lights: number;
  raceStart: number;
  laps: number;
  wetness: number;
  standings: Standing[];
  quali: [string, QualiEntry][];
}

export type ClientMessage =
  | { t: 'hello'; name: string; version: number }
  | { t: 'input'; inputs: { seq: number; input: PlayerInput }[] };

export type HostMessage =
  | { t: 'welcome'; id: string }
  | { t: 'reject'; reason: string }
  | { t: 'lobby'; lobby: LobbyState }
  | { t: 'start'; track: TrackDef; settings: RaceSettings; players: PlayerInfo[] }
  | { t: 'snap'; time: number; cars: CarSnap[] }
  | { t: 'state'; time: number; session: SessionSnap; timing: TimingSnap[] }
  | { t: 'events'; time: number; events: SessionEvent[] };
