import type { TimerState } from '../game/lapTimer';
import type { SafetyCarPhase, SafetyCarSnap } from '../sim/safetyCar';
import type { Difficulty } from '../sim/ai/botDriver';
import type { DropKind, ItemKind } from '../sim/items';
import type { PitPhase } from '../sim/pit';
import type { GameMode, PlayerInfo, QualiEntry, RaceSettings, SessionEvent, SessionPhase, Standing } from '../sim/session';
import type { Compound } from '../sim/tyres';
import type { Penalty, DrsHint } from '../sim/world';
import type { TrackDef } from '../track/types';

/** Bump when messages change, so mismatched builds refuse to connect. */
export const PROTOCOL_VERSION = 7;
export const MAX_PLAYERS = 10;

export interface LobbyPlayer extends PlayerInfo {
  host: boolean;
  /** Set for computer drivers. */
  bot?: Difficulty;
}

/**
 * A player's connection to the host, measured by the host: round-trip time (ms) and
 * whether WebRTC had to fall back to a relay server (TURN) instead of a direct link.
 * Null while unknown, and for the host itself and bots.
 */
export interface NetInfo {
  id: string;
  ping: number | null;
  relayed: boolean | null;
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
  parts: [number, number, number, number];
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
  drsHint: DrsHint;
  tow: number;
  pit: PitPhase;
  pitEnds: number;
  limiter: boolean;
  next: Compound;
  /** Last input sequence number from this car's player that the host has applied. */
  ack: number;
  /** Party mode, only sent while there is something: item held, effects left (boost, rainbow, hooked; s), who hooked us, push (N). */
  it?: ItemKind | null;
  fx?: [number, number, number, number];
  hookBy?: string | null;
  push?: number;
}

/**
 * Party mode: boxes that are gone for now (by index in placeItemBoxes), rockets in flight
 * [x, y, heading, speed] and items dropped on the track [kind, x, y, heading].
 */
export interface ItemsSnap {
  drops: [DropKind, number, number, number][];
  off: number[];
  rockets: [number, number, number, number][];
}

export interface TimingSnap extends TimerState {
  id: string;
  delta: number | null;
  penalties: Penalty[];
  compoundsUsed: Compound[];
  stops: number;
}

export interface SessionSnap {
  mode: GameMode;
  phase: SessionPhase;
  lights: number;
  raceStart: number;
  laps: number;
  /** The one-stop / two-compound rule applies this race. */
  mandatoryStop: boolean;
  /** Tyres wear this race. */
  tyreWear: boolean;
  /** Cars pass through each other this race. */
  noContact: boolean;
  wetness: number;
  standings: Standing[];
  quali: [string, QualiEntry][];
  /** Cars waiting after a reset, and when they go back on track. */
  recovering: [string, number][];
  /** Grid: who is ready, and when the lights start at the latest. */
  ready: string[];
  gridEndsAt: number;
  /** The safety car's state, if it is on track. */
  safetyCar: SafetyCarPhase | null;
  /** Cars that may not overtake (safety car out, or the restart before the line). */
  noOvertaking: string[];
}

/** One step's input, packed: [seq, throttle, brake, steer, flags (DRS, ERS, limiter, R, ready), tyre]. */
export type PackedInput = [number, number, number, number, number, number];

export type ClientMessage =
  | { t: 'hello'; name: string; version: number }
  /**
   * The latest inputs, plus a few older ones the host hasn't acknowledged yet, so a lost
   * packet costs nothing (inputs go over the fast channel, which never resends).
   */
  | { t: 'input'; inputs: PackedInput[] }
  /** Answer to the host's ping, straight away. */
  | { t: 'pong'; n: number };

export type HostMessage =
  | { t: 'welcome'; id: string }
  | { t: 'reject'; reason: string }
  | { t: 'lobby'; lobby: LobbyState }
  | { t: 'start'; track: TrackDef; settings: RaceSettings; players: PlayerInfo[] }
  | { t: 'snap'; time: number; cars: CarSnap[]; sc?: SafetyCarSnap; items?: ItemsSnap }
  | { t: 'state'; time: number; session: SessionSnap; timing: TimingSnap[] }
  | { t: 'events'; time: number; events: SessionEvent[] }
  /** Sent about once a second; the client answers with a pong to measure the round trip. */
  | { t: 'ping'; n: number }
  /** Everyone's ping and connection type, about once a second. */
  | { t: 'net'; net: NetInfo[] };
