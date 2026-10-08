import type { SessionEvent } from '../sim/session';
import { RaceWorld, type PlayerInput, type Racer } from '../sim/world';
import { parseTrackDef } from '../track/io';
import { Track } from '../track/track';
import { PROTOCOL_VERSION, type CarSnap, type HostMessage, type LobbyState, type SessionSnap } from './protocol';
import { applyCarPhysics, applyCarStatus, applyTiming } from './snapshot';
import type { Connection } from './transport';

/** Other cars are drawn this far in the past, so there are two snapshots to blend between. */
const INTERPOLATION_DELAY = 0.1;
/** How fast the visual offset after a prediction correction fades (1/s). */
const CORRECTION_FADE = 10;

export type ClientStatus = 'connecting' | 'lobby' | 'racing' | 'rejected' | 'closed';

export interface Pose {
  x: number;
  y: number;
  heading: number;
}

/**
 * A player who joined someone else's lobby. Mirrors the host's race for display, and
 * predicts its own car locally so steering feels instant despite network delay.
 */
export class ClientGame {
  status: ClientStatus = 'connecting';
  rejectReason = '';
  id: string | null = null;
  lobby: LobbyState | null = null;
  track: Track | null = null;
  world: RaceWorld | null = null;
  session: SessionSnap | null = null;
  deltas = new Map<string, number | null>();
  /** Estimated host clock minus local clock (s). */
  private clockOffset: number | null = null;
  private snaps: { time: number; cars: Map<string, CarSnap> }[] = [];
  private pending: { seq: number; input: PlayerInput }[] = [];
  private outbox: { seq: number; input: PlayerInput }[] = [];
  private seq = 0;
  private events: SessionEvent[] = [];
  private offset = { x: 0, y: 0 };
  private latestOwn: CarSnap | null = null;
  /** How far our predicted car was from the host's at the last correction (m). For debugging/tests. */
  lastCorrection = 0;

  constructor(
    private readonly conn: Connection,
    name: string,
    private readonly clock: () => number,
  ) {
    conn.onMessage((m) => this.handle(m as HostMessage));
    conn.onClose(() => {
      if (this.status !== 'rejected') this.status = 'closed';
    });
    conn.send({ t: 'hello', name, version: PROTOCOL_VERSION });
  }

  get me(): Racer | undefined {
    return this.id ? this.world?.racer(this.id) : undefined;
  }

  /** The host's clock right now (s), as best we can tell. */
  serverTime(): number {
    return this.clock() + (this.clockOffset ?? 0);
  }

  /** One local physics step: record and predict the input. Call at the same rate as the host. */
  step(dt: number, input: PlayerInput): void {
    if (this.status !== 'racing' || !this.track) return;
    const item = { seq: ++this.seq, input };
    this.pending.push(item);
    this.outbox.push(item);
    const me = this.me;
    if (me && this.predicting()) me.car.step(input, dt, this.track);
  }

  /** Send queued inputs (call once per frame). */
  flush(): void {
    if (this.outbox.length === 0) return;
    this.conn.send({ t: 'input', inputs: this.outbox });
    this.outbox = [];
  }

  takeEvents(): SessionEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  /** Where to draw a car this frame. */
  pose(id: string, dt: number): Pose | null {
    const me = this.me;
    if (me && id === me.id && this.predicting()) {
      const fade = Math.exp(-dt * CORRECTION_FADE);
      this.offset.x *= fade;
      this.offset.y *= fade;
      return { x: me.car.x + this.offset.x, y: me.car.y + this.offset.y, heading: me.car.heading };
    }
    return this.interpolated(id, this.serverTime() - INTERPOLATION_DELAY);
  }

  close(): void {
    this.conn.close();
  }

  private predicting(): boolean {
    const own = this.latestOwn;
    const phase = this.session?.phase;
    return (
      own !== null &&
      !own.frozen &&
      !own.ret &&
      (own.pit === 'out' || own.pit === 'leaving') &&
      (phase === 'qualifying' || phase === 'lights' || phase === 'race')
    );
  }

  private handle(msg: HostMessage): void {
    switch (msg.t) {
      case 'welcome':
        this.id = msg.id;
        this.status = 'lobby';
        break;
      case 'reject':
        this.rejectReason = msg.reason;
        this.status = 'rejected';
        this.conn.close();
        break;
      case 'lobby':
        this.lobby = msg.lobby;
        this.status = 'lobby';
        this.world = null;
        this.track = null;
        this.session = null;
        break;
      case 'start': {
        this.track = new Track(parseTrackDef(msg.track));
        this.world = new RaceWorld(this.track, { drsRule: 'race', wetness: 0 });
        for (const p of msg.players) this.world.addRacer(p.id, p.name, p.color);
        this.snaps = [];
        this.pending = [];
        this.latestOwn = null;
        this.clockOffset = null;
        this.status = 'racing';
        break;
      }
      case 'snap':
        this.onSnap(msg.time, msg.cars);
        break;
      case 'state':
        this.syncClock(msg.time);
        this.session = msg.session;
        if (this.world) {
          this.world.options.wetness = msg.session.wetness;
          for (const t of msg.timing) {
            const r = this.world.racer(t.id);
            if (r) applyTiming(r, t);
            this.deltas.set(t.id, t.delta);
          }
        }
        break;
      case 'events':
        this.events.push(...msg.events);
        break;
    }
  }

  private onSnap(time: number, cars: CarSnap[]): void {
    const world = this.world;
    if (!world || !this.track) return;
    this.syncClock(time);
    this.snaps.push({ time, cars: new Map(cars.map((c) => [c.id, c])) });
    while (this.snaps.length > 30) this.snaps.shift();
    world.time = time;

    for (const c of cars) {
      const r = world.racer(c.id);
      if (!r) continue;
      applyCarStatus(r, c);
      if (c.id !== this.id) applyCarPhysics(r, c);
    }

    // Reconcile our own car: take the host's state, then replay inputs it hasn't seen yet.
    const own = this.id ? cars.find((c) => c.id === this.id) : undefined;
    const me = this.me;
    if (!own || !me) return;
    this.latestOwn = own;
    this.pending = this.pending.filter((p) => p.seq > own.ack);
    const before = { x: me.car.x, y: me.car.y };
    applyCarPhysics(me, own);
    if (this.predicting()) {
      for (const p of this.pending) me.car.step(p.input, 1 / 120, this.track);
      // Hide small corrections by fading from where the car was drawn.
      const jump = Math.hypot(before.x - me.car.x, before.y - me.car.y);
      this.lastCorrection = jump;
      if (jump < 8) {
        this.offset.x += before.x - me.car.x;
        this.offset.y += before.y - me.car.y;
      } else {
        this.offset = { x: 0, y: 0 };
      }
    } else {
      this.offset = { x: 0, y: 0 };
    }
  }

  private interpolated(id: string, t: number): Pose | null {
    const snaps = this.snaps;
    if (snaps.length === 0) return null;
    let b = snaps.findIndex((s) => s.time >= t);
    if (b <= 0) {
      const s = (b === 0 ? snaps[0] : snaps[snaps.length - 1]).cars.get(id);
      return s ? { x: s.x, y: s.y, heading: s.h } : null;
    }
    const sa = snaps[b - 1];
    const sb = snaps[b];
    const ca = sa.cars.get(id);
    const cb = sb.cars.get(id);
    if (!ca || !cb) return ca ? { x: ca.x, y: ca.y, heading: ca.h } : null;
    const k = (t - sa.time) / (sb.time - sa.time);
    let dh = cb.h - ca.h;
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    return { x: ca.x + (cb.x - ca.x) * k, y: ca.y + (cb.y - ca.y) * k, heading: ca.h + dh * k };
  }

  private syncClock(hostTime: number): void {
    const offset = hostTime - this.clock();
    // Take the largest offset seen recently: delays only ever make messages late.
    if (this.clockOffset === null || offset > this.clockOffset) this.clockOffset = offset;
    else this.clockOffset += (offset - this.clockOffset) * 0.02;
  }
}
