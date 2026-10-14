/** A two-way message channel to one peer. Messages must be JSON-compatible. */
export interface Connection {
  /** Reliable and in order. */
  send(msg: unknown): void;
  /**
   * For the high-rate stream (snapshots, inputs, pings): never resent, so it may be dropped or
   * arrive out of order, but one lost packet doesn't hold up everything after it.
   */
  sendFast(msg: unknown): void;
  onMessage(cb: (msg: unknown) => void): void;
  onClose(cb: () => void): void;
  close(): void;
  /** How the connection is routed: straight between the browsers, or through a relay server. */
  route?(): Promise<'direct' | 'relayed' | null>;
}

/** The host side: hands out an invite code and accepts incoming connections. */
export interface HostTransport {
  readonly code: string;
  onConnection(cb: (conn: Connection) => void): void;
  close(): void;
}

/** A host nobody can join: for racing bots on your own, without going online. */
export class OfflineTransport implements HostTransport {
  readonly code = '';
  onConnection(): void {}
  close(): void {}
}

/**
 * In-memory network for tests: delivers messages after `latency` seconds of simulated
 * time when `advance` is called. Messages are JSON round-tripped like a real network.
 * `fastLoss` drops that share of fast-channel messages, and delays some of the rest by up to
 * `fastJitter` seconds, so they arrive out of order.
 */
export class LoopbackNetwork {
  private time = 0;
  private queue: { at: number; deliver: () => void }[] = [];
  private hosts = new Map<string, (conn: Connection) => void>();
  /** Deterministic randomness for the fast channel's losses. */
  private seed = 12345;

  constructor(
    readonly latency = 0,
    readonly fastLoss = 0,
    readonly fastJitter = 0,
  ) {}

  /** mulberry32: small, fast and the same every run. */
  private random(): number {
    let t = (this.seed = (this.seed + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  host(code: string): HostTransport {
    let handler: (conn: Connection) => void = () => {};
    this.hosts.set(code, (c) => handler(c));
    return {
      code,
      onConnection: (cb) => (handler = cb),
      close: () => this.hosts.delete(code),
    };
  }

  connect(code: string): Connection {
    const accept = this.hosts.get(code);
    if (!accept) throw new Error(`No host ${code}`);
    const [a, b] = this.pair();
    accept(b);
    return a;
  }

  /** Move simulated time forward, delivering due messages. */
  advance(dt: number): void {
    this.time += dt;
    const due = this.queue.filter((m) => m.at <= this.time + 1e-9);
    this.queue = this.queue.filter((m) => m.at > this.time + 1e-9);
    for (const m of due) m.deliver();
  }

  private pair(): [Connection, Connection] {
    const make = () => ({
      handlers: [] as ((msg: unknown) => void)[],
      closers: [] as (() => void)[],
      open: true,
    });
    const ends = [make(), make()];
    const deliver = (self: number, msg: unknown, delay: number) => {
      const other = ends[1 - self];
      const copy = JSON.parse(JSON.stringify(msg));
      this.queue.push({ at: this.time + this.latency + delay, deliver: () => other.open && other.handlers.forEach((h) => h(copy)) });
    };
    const conn = (self: number): Connection => ({
      send: (msg) => deliver(self, msg, 0),
      sendFast: (msg) => {
        if (this.random() < this.fastLoss) return;
        deliver(self, msg, this.random() * this.fastJitter);
      },
      onMessage: (cb) => ends[self].handlers.push(cb),
      onClose: (cb) => ends[self].closers.push(cb),
      close: () => {
        for (const e of ends) {
          if (!e.open) continue;
          e.open = false;
          e.closers.forEach((c) => c());
        }
      },
    });
    return [conn(0), conn(1)];
  }
}
