import { F1_CAR } from '../../physics/carParams';
import type { Track } from '../../track/track';
import { fastLane, PIT_SPEED_LIMIT } from '../pit';
import { pitAdvice } from '../strategy';
import { COMPOUNDS, DRY_COMPOUNDS, type Compound } from '../tyres';
import { IDLE_INPUT, type PlayerInput, type RaceWorld, type Racer } from '../world';
import { racingLine, speedProfile, type RacingLine } from './racingLine';

export type Difficulty = 'easy' | 'medium' | 'hard';

export const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];

interface Skill {
  /** Makes one defensive move per straight when a car behind is attacking. */
  defends: boolean;
  /** Share of the car's grip used in corners and under braking. */
  pace: number;
  /** Seconds to react to lights out. */
  reaction: [number, number];
  /** Uses ERS to attack and defend. */
  ers: boolean;
}

const SKILL: Record<Difficulty, Skill> = {
  easy: { defends: false, pace: 0.74, reaction: [0.45, 0.7], ers: false },
  medium: { defends: true, pace: 0.86, reaction: [0.28, 0.42], ers: true },
  hard: { defends: true, pace: 0.95, reaction: [0.17, 0.26], ers: true },
};

/** What the bot needs to know about the session. */
export interface BotContext {
  phase: 'practice' | 'qualifying' | 'grid' | 'lights' | 'race' | 'finished';
  /** Time the lights went out (race), for reaction time. */
  raceStart: number;
  laps: number | null;
  mandatoryStop: boolean;
}

const CAR_LENGTH = 5.6;
const SAFE_LATERAL = 2.6;
const PASS_OFFSET = 3.2;
const LATERAL_SPEED = 4;
/** Seconds after lights out that bots stay in their grid column. */
const START_COLUMN_TIME = 4;
/** A car behind closer than this many seconds (at the closing speed) is too close to move across in front of. */
const CHOP_TIME = 1;
/** Corners tighter than this (curvature, 1/m) end a straight: the defensive move is used up until the next one. */
const CORNER_CURVATURE = 1 / 120;

/**
 * A computer driver: follows a racing line at its difficulty's pace, brakes to a planned
 * speed for each corner, avoids and overtakes cars ahead, uses DRS/ERS, pits when the race
 * engineer says so, and gets itself unstuck. Runs only on the host.
 */
export class BotDriver {
  private readonly skill: Skill;
  private readonly line: RacingLine;
  private readonly profile: number[];
  private readonly reaction: number;
  /** How far the bot is choosing to be off its racing line (m), moved smoothly (traffic, pits). */
  private deviation = 0;
  private startLateral: number | null = null;
  private stuckFor = 0;
  /** When the car was wrecked, so the bot can reset after a moment. */
  private retiredAt: number | null = null;
  private reverseUntil = 0;
  private nextTyre: Compound = 'medium';
  /** Close behind someone: worth spending ERS. */
  private attacking = false;
  /** Where we moved to defend (lateral offset), held until the braking zone. */
  private defenceLateral: number | null = null;
  /** The one defensive move allowed on this straight has been made. */
  private defended = false;

  constructor(
    private readonly track: Track,
    readonly id: string,
    readonly difficulty: Difficulty,
  ) {
    this.skill = SKILL[difficulty];
    this.line = racingLine(track);
    this.profile = speedProfile(track, this.line, F1_CAR, this.skill.pace);
    const [lo, hi] = this.skill.reaction;
    this.reaction = lo + (hi - lo) * hash01(id);
  }

  drive(world: RaceWorld, ctx: BotContext, dt: number): PlayerInput {
    const me = world.racer(this.id);
    if (!me) return IDLE_INPUT;
    const car = me.car;
    const base: PlayerInput = { ...IDLE_INPUT, nextTyre: this.chooseTyre(me, world, ctx) };
    if (car.retired) {
      // Wrecked: sit for a moment, then reset to the track like a player would.
      this.retiredAt ??= world.time;
      return { ...base, brake: 1, reset: world.time - this.retiredAt > 2 };
    }
    this.retiredAt = null;
    // On the grid (cars are held still there): bots are always ready.
    if (ctx.phase === 'grid' || ctx.phase === 'lights') return { ...base, brake: 1, ready: true };
    if (me.frozen) return { ...base, brake: 1 };
    // Reacting to lights out: no pedals (holding the brake at a standstill would reverse).
    if (ctx.phase === 'race' && world.time - ctx.raceStart < this.reaction) return base;

    const q = this.track.query(car.x, car.y);
    if (!q) return base;
    const n = this.track.samples.length;
    const speed = car.speed;

    // Unstuck: if barely moving for a while (e.g. nose in a wall), reverse out.
    if (world.time < this.reverseUntil) return { ...base, brake: 1, steer: q.d > 0 ? 1 : -1 };
    const moving = speed > 1.5 || me.pit.phase === 'stopped' || me.pit.phase === 'in';
    this.stuckFor = moving ? 0 : this.stuckFor + dt;
    if (this.stuckFor > 1.5) {
      this.stuckFor = 0;
      this.reverseUntil = world.time + 1.2;
    }

    const advice = pitAdvice({
      laps: ctx.phase === 'race' ? ctx.laps : null,
      currentLap: me.timer.lapsCompleted + 1,
      mandatoryStop: ctx.phase === 'race' && ctx.mandatoryStop,
      stops: me.pit.stops,
      compoundsUsed: me.compoundsUsed,
      compound: me.tyres.compound,
      nextTyre: base.nextTyre,
      wear: me.tyres.wear,
      damage: car.damage,
      wetness: world.options.wetness,
    });

    // Where across the track to drive: racing line, pit lane, or around traffic.
    let wanted = this.line.offset[q.index];
    let speedCap = Infinity;
    const lane = this.track.pit;
    const pitting = lane && ctx.phase === 'race' && (me.pit.phase !== 'out' || advice.boxNow);
    if (lane && pitting) {
      const toEntry = this.track.forwardDistance(q.s, lane.entry);
      const inLane = me.pit.phase !== 'out' || this.track.inRange(q.s, lane.entry, lane.wallStart);
      const merging = me.pit.phase === 'leaving' && !this.track.inRange(q.s, lane.entry, lane.wallEnd);
      if (merging) {
        // Past the pit wall: rejoin the racing line.
        wanted = this.line.offset[q.index];
      } else if (inLane) {
        wanted = fastLane(this.track, q.sample.halfWidth);
        // Pulling out of the box: get across to the fast lane before picking up speed.
        if (me.pit.phase === 'leaving' && Math.abs(q.d - wanted) > 1.2) speedCap = Math.min(speedCap, 7);
        if (me.pit.phase === 'out') speedCap = Math.min(speedCap, PIT_SPEED_LIMIT - 3);
      }
      else if (toEntry < 60) {
        // Line up on the pit side and slow down for the entry (late, so we never run wide out
        // of a corner that comes just before the pit entry).
        wanted = lane.side * (q.sample.halfWidth - 2.5);
        speedCap = Math.min(speedCap, 16 + toEntry * 0.4);
      }
    }
    const collisionsOn = world.options.collisions !== false;
    const sinceStart = ctx.phase === 'race' ? world.time - ctx.raceStart : Infinity;
    // Off the line: hold our grid column for a few seconds so the two columns don't merge.
    if (sinceStart < START_COLUMN_TIME) {
      this.startLateral ??= q.d;
      wanted = this.startLateral;
    }
    const lookIdx = Math.round((speed * 0.25) / 2);
    const braking = Math.min(this.profile[q.index], this.profile[(q.index + lookIdx) % n]) < speed - 1;
    if (Math.abs(this.line.curvature[q.index]) > CORNER_CURVATURE) this.defended = false;
    if (braking || pitting || !collisionsOn || ctx.phase !== 'race') this.defenceLateral = null;
    else if (sinceStart > START_COLUMN_TIME && this.skill.defends) this.defend(world, me, q.s, q.index, speed);
    if (this.defenceLateral !== null) wanted = this.defenceLateral;
    let minLateral = -Infinity;
    let maxLateral = Infinity;
    if (collisionsOn && me.pit.phase !== 'in' && me.pit.phase !== 'stopped') {
      const traffic = this.traffic(world, me, q.s, q.d, wanted, sinceStart < 8);
      // In the pit lane we only slow for traffic; the lane decides where we drive.
      if (!pitting) {
        wanted = traffic.lateral;
        minLateral = traffic.minLateral;
        maxLateral = traffic.maxLateral;
      }
      speedCap = Math.min(speedCap, traffic.speedCap);
    }
    const edge = q.sample.halfWidth - 1.4;
    if (me.pit.phase === 'out' && !pitting) wanted = Math.max(-edge, Math.min(edge, wanted));
    // The racing line is followed exactly; only moves away from it are smoothed.
    const lineHere = this.line.offset[q.index];
    const wantedDeviation = wanted - lineHere;
    this.deviation += Math.max(-LATERAL_SPEED * dt, Math.min(LATERAL_SPEED * dt, wantedDeviation - this.deviation));
    // Never let the racing line pull us towards a car we must keep clear of.
    if (lineHere + this.deviation > maxLateral) this.deviation = Math.max(maxLateral, q.d) - lineHere;
    if (lineHere + this.deviation < minLateral) this.deviation = Math.min(minLateral, q.d) - lineHere;

    // Steering: pure pursuit towards a point ahead at the target lateral position.
    const look = 7 + speed * 0.32;
    const aheadIdx = (q.index + Math.round(look / 2)) % n;
    const ahead = this.track.samples[aheadIdx];
    let aheadLateral = this.line.offset[aheadIdx] + this.deviation;
    // Heading for (or in) the pit lane: aim at the lane itself, not relative to the racing
    // line, which may swing across the track right where the pit entry is.
    if (pitting) aheadLateral = wanted;
    if (me.pit.phase === 'out' && !pitting) aheadLateral = Math.max(-edge, Math.min(edge, aheadLateral));
    // Aim clear of cars alongside, even where the racing line ahead swings towards them.
    if (aheadLateral > maxLateral) aheadLateral = Math.max(maxLateral, q.d);
    if (aheadLateral < minLateral) aheadLateral = Math.min(minLateral, q.d);
    const tx = ahead.x + ahead.nx * aheadLateral;
    const ty = ahead.y + ahead.ny * aheadLateral;
    let alpha = Math.atan2(ty - car.y, tx - car.x) - car.heading;
    alpha = Math.atan2(Math.sin(alpha), Math.cos(alpha));
    const dist = Math.hypot(tx - car.x, ty - car.y);
    const curvature = (2 * Math.sin(alpha)) / Math.max(dist, 1);
    const p = car.params;
    const grip = p.mu * car.gripFactor * (p.mass * 9.81 + p.downforceCoef * speed * speed);
    const maxYaw = Math.min(speed / p.minTurnRadius, grip / p.mass / Math.max(speed, 1));
    const steer = Math.max(-1, Math.min(1, (curvature * Math.max(speed, 3)) / Math.max(maxYaw, 0.05)));

    // Speed: the planned speed here and a little ahead, scaled for grip (tyres, rain, damage).
    let target = Math.min(this.profile[q.index], this.profile[(q.index + lookIdx) % n]);
    const gripScale = car.gripFactor * (1 - 0.4 * car.parts.frontWing) * (1 - 0.15 * (car.parts.left + car.parts.right) / 2);
    target *= Math.sqrt(Math.max(0.2, gripScale));
    // Off the racing line, corners must be taken a bit slower.
    target *= 1 - Math.min(0.15, Math.abs(this.deviation) * 0.02);
    if (ctx.phase === 'qualifying' && me.timer.lapStart === null) target *= 0.85; // out-lap
    target = Math.min(target, speedCap);
    const err = target - speed;
    const throttle = err > 0.3 ? 1 : err > -0.3 ? 0.4 : 0;
    // Never brake at a standstill: that would reverse.
    const brake = err < -0.8 && speed > 1 ? Math.min(1, -err / 2.5) : 0;

    // ERS: on straights when attacking, defending or with a full battery.
    const straight = Math.abs(this.line.curvature[q.index]) < 1 / 300 && speed > 35;
    const useErs = this.skill.ers && straight && throttle === 1 && (me.ers > 0.85 || me.drsOpen || this.attacking);

    return { ...base, throttle, brake, steer, drs: true, ers: useErs };
  }

  /**
   * Pick the lateral position and speed limit around nearby cars:
   * - never steer into a car alongside or just behind;
   * - keep a safe gap to the car ahead (bigger at speed), unless we're already beside it;
   * - pull out to pass a slower car when there's room (not in the first seconds of a race).
   */
  private traffic(
    world: RaceWorld,
    me: Racer,
    s: number,
    d: number,
    wanted: number,
    startCaution: boolean,
  ): { lateral: number; speedCap: number; minLateral: number; maxLateral: number } {
    const L = this.track.length;
    const speed = me.car.speed;
    const here = this.track.query(me.car.x, me.car.y);
    /** Sideways speed across the track (m/s, positive = right). */
    const sideways = (c: Racer['car']) => (here ? c.vx * here.nx + c.vy * here.ny : 0);
    const mySideways = sideways(me.car);
    let lateral = wanted;
    let speedCap = Infinity;
    let minLateral = -Infinity;
    let maxLateral = Infinity;
    let closest = Infinity;
    this.attacking = false;
    /** Cars right in front of our nose, and the speed that keeps us off their gearbox. */
    const nose: { d: number; room: number; cap: number }[] = [];
    for (const other of world.racers) {
      if (other === me || other.frozen) continue;
      const q = this.track.query(other.car.x, other.car.y);
      if (!q) continue;
      let gap = this.track.forwardDistance(s, q.s);
      if (gap > L / 2) gap -= L;
      const side = q.d - d;

      // Straight in front of our nose, measured directly (in a hairpin the distance along the
      // track says little about how close a car on another line really is).
      const fx = Math.cos(me.car.heading);
      const fy = Math.sin(me.car.heading);
      const dx = other.car.x - me.car.x;
      const dy = other.car.y - me.car.y;
      const ahead = dx * fx + dy * fy;
      const across = -dx * fy + dy * fx;
      if (ahead > CAR_LENGTH && ahead < 25 && Math.abs(across) < 2.4) {
        const along = other.car.vx * fx + other.car.vy * fy;
        const room = ahead - CAR_LENGTH - 1.5 - speed * 0.1;
        // Too close (or touching): drop back rather than push them along.
        nose.push({ d: q.d, room: Math.max(0, room), cap: Math.max(0, along) + room * 0.5 });
      }

      // Beside us (overlapping), or just behind with their nose alongside: keep a car's
      // width away. A car directly behind us is their problem, not ours.
      const overlapping = (gap > -(CAR_LENGTH + 1) && gap < CAR_LENGTH + 1.5) || (Math.abs(ahead) < CAR_LENGTH + 1 && Math.abs(across) < 6);
      const noseIn = gap <= -(CAR_LENGTH + 1) && gap > -12 && Math.abs(side) > 1.5;
      if (overlapping || noseIn) {
        // We can't stop sliding sideways at once: keep more room the faster we close on them.
        const closingSideways = (mySideways - sideways(other.car)) * Math.sign(side);
        const room = SAFE_LATERAL + Math.min(2.5, Math.max(0, closingSideways) * 0.35);
        if (Math.abs(side) < room + 2) {
          if (side > 0) maxLateral = Math.min(maxLateral, q.d - room);
          else minLateral = Math.max(minLateral, q.d + room);
        }
        continue;
      }
      // Behind us in another lane and closing: moving across in front of them now would
      // leave them no time to react (and is a penalty). Hold our line, don't move towards them.
      if (gap < 0 && Math.abs(side) > 1.5) {
        const closing = Math.max(0, other.car.speed - speed);
        if (-gap < CAR_LENGTH + 4 + closing * CHOP_TIME * 2) {
          if (side > 0) maxLateral = Math.min(maxLateral, Math.max(d, q.d - SAFE_LATERAL));
          else minLateral = Math.max(minLateral, Math.min(d, q.d + SAFE_LATERAL));
        }
        continue;
      }
      if (gap <= 0 || gap > 60) continue;

      // Ahead: are they on the line we're about to drive?
      const ourLineThere = this.line.offset[q.index] + this.deviation;
      if (Math.abs(q.d - ourLineThere) > SAFE_LATERAL + 0.5 && Math.abs(side) > SAFE_LATERAL) continue;
      const closing = speed - other.car.speed;
      if (gap < closest) {
        closest = gap;
        this.attacking = gap < 35;
        const half = q.sample.halfWidth - 1.4;
        const passRight = q.d + PASS_OFFSET;
        const passLeft = q.d - PASS_OFFSET;
        const canRight = passRight <= half;
        const canLeft = passLeft >= -half;
        // At the start only go round cars that have stalled.
        const mayPass = !startCaution || other.car.speed < 2;
        if (mayPass && closing > 0.5 && gap < 35 && (canLeft || canRight)) {
          // Pass on the side closer to where we already are.
          lateral = canRight && (!canLeft || Math.abs(passRight - d) <= Math.abs(passLeft - d)) ? passRight : passLeft;
        }
      }
      // Until we're actually beside them, don't run into the back of them: also when our
      // line is about to take us into their lane and we aren't going round them.
      const inPath = Math.abs(side) < SAFE_LATERAL || (lateral === wanted && Math.abs(q.d - ourLineThere) < SAFE_LATERAL);
      if (inPath) {
        const safeGap = CAR_LENGTH + 3 + speed * 0.22 + Math.max(0, closing) * 1.1 + (startCaution && other.car.speed >= 2 ? 6 : 0);
        const braking = other.car.brake > 0.3 ? 4 : 0;
        let cap = other.car.speed - braking + (gap - safeGap) * 0.4;
        // Going round a stopped or very slow car: keep creeping forward, or we can never steer past.
        if (lateral !== wanted && gap > CAR_LENGTH + 1.5 && other.car.speed < 5) cap = Math.max(cap, 4);
        speedCap = Math.min(speedCap, cap);
      }
    }
    if (minLateral > maxLateral) {
      // Squeezed: hold our position.
      lateral = d;
      minLateral = maxLateral = d;
    } else lateral = Math.max(minLateral, Math.min(maxLateral, lateral));
    // Unless we're already steering out of their lane to go round them: then just creep on.
    for (const c of nose) {
      const goingRound = Math.abs(c.d - lateral) >= SAFE_LATERAL && Math.abs(lateral - d) >= 0.5;
      speedCap = Math.min(speedCap, goingRound ? Math.max(c.cap, Math.min(6, 2 + c.room)) : c.cap);
    }
    return { lateral, speedCap: Math.max(0, speedCap), minLateral, maxLateral };
  }

  /**
   * Defending, by the rules: one move per straight, made early (while the attacker is still
   * well behind), to cover the inside of the next corner. The move is then held until the
   * braking zone; no weaving.
   */
  private defend(world: RaceWorld, me: Racer, s: number, index: number, speed: number): void {
    if (this.defended) return;
    const L = this.track.length;
    let attacker: Racer | null = null;
    let attackerGap = Infinity;
    for (const other of world.racers) {
      if (other === me || other.frozen || other.car.retired || other.pit.phase !== 'out') continue;
      const q = this.track.query(other.car.x, other.car.y);
      if (!q) continue;
      const behind = this.track.forwardDistance(q.s, s);
      if (behind > L / 2 || behind < CAR_LENGTH + 1) continue;
      const closing = other.car.speed - speed;
      // Close enough to be a threat, not so close that a move now would chop them.
      const threat = behind < 30 || (closing > 1 && behind < 45);
      const tooLate = behind < CAR_LENGTH + 4 + Math.max(0, closing) * CHOP_TIME * 2;
      if (threat && !tooLate && behind < attackerGap) {
        attacker = other;
        attackerGap = behind;
      }
    }
    if (!attacker) return;
    // Cover the inside of the next proper corner.
    const n = this.track.samples.length;
    for (let k = 1; k < 150; k++) {
      const i = (index + k) % n;
      const curv = this.line.curvature[i];
      if (Math.abs(curv) > CORNER_CURVATURE) {
        const sample = this.track.samples[index];
        this.defenceLateral = Math.sign(curv) * (sample.halfWidth - 2.6);
        this.defended = true;
        return;
      }
    }
  }

  /** Tyres for the next stop (and the start). */
  private chooseTyre(me: Racer, world: RaceWorld, ctx: BotContext): Compound {
    const wet = world.options.wetness;
    if (wet >= 0.7) return (this.nextTyre = 'wet');
    if (wet >= 0.35) return (this.nextTyre = 'inter');
    if (ctx.phase === 'grid' || ctx.phase === 'lights' || ctx.phase === 'qualifying') return (this.nextTyre = 'medium');
    const lapsLeft = (ctx.laps ?? 10) - me.timer.lapsCompleted;
    const used = new Set(me.compoundsUsed);
    // Second stint: a compound that lasts the distance and satisfies the two-compound rule.
    const options = DRY_COMPOUNDS.filter((c) => !(ctx.mandatoryStop && used.size === 1 && used.has(c)));
    const lasting = options.filter((c) => COMPOUNDS[c].lifeLaps * 0.75 >= lapsLeft);
    this.nextTyre = (lasting[0] ?? options[options.length - 1] ?? 'hard') as Compound;
    return this.nextTyre;
  }
}

/** Stable 0..1 from a string, for per-bot variation that's the same on every run. */
function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 1000) / 1000;
}

