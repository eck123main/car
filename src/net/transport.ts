/** A two-way message channel to one peer. Messages must be JSON-compatible. */
export interface Connection {
  send(msg: unknown): void;
  onMessage(cb: (msg: unknown) => void): void;
  onClose(cb: () => void): void;
  close(): void;
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
 */
export class LoopbackNetwork {
  private time = 0;
  private queue: { at: number; deliver: () => void }[] = [];
  private hosts = new Map<string, (conn: Connection) => void>();

  constructor(readonly latency = 0) {}

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
    const conn = (self: number): Connection => ({
      send: (msg) => {
        const other = ends[1 - self];
        const copy = JSON.parse(JSON.stringify(msg));
        this.queue.push({ at: this.time + this.latency, deliver: () => other.open && other.handlers.forEach((h) => h(copy)) });
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
