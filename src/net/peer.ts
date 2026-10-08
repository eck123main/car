import Peer, { type DataConnection } from 'peerjs';
import type { Connection, HostTransport } from './transport';

/**
 * WebRTC transport via PeerJS. The free public PeerJS server only introduces the
 * browsers to each other; game traffic then goes directly between them.
 */
const ID_PREFIX = 'f1td-';
const CONNECT_TIMEOUT = 15_000;

function randomCode(): string {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function wrap(conn: DataConnection): Connection {
  const outbox: unknown[] = [];
  let open = conn.open;
  conn.on('open', () => {
    open = true;
    for (const m of outbox.splice(0)) conn.send(m);
  });
  return {
    send: (msg) => (open ? conn.send(msg) : outbox.push(msg)),
    onMessage: (cb) => conn.on('data', cb),
    onClose: (cb) => {
      conn.on('close', cb);
      conn.on('error', cb);
    },
    close: () => conn.close(),
  };
}

/** Become a host. Resolves with the invite code once the signalling server accepts us. */
export function createHost(): Promise<HostTransport> {
  return new Promise((resolve, reject) => {
    const code = randomCode();
    const peer = new Peer(ID_PREFIX + code);
    let handler: (c: Connection) => void = () => {};
    peer.on('connection', (dc) => handler(wrap(dc)));
    peer.on('open', () =>
      resolve({
        code,
        onConnection: (cb) => (handler = cb),
        close: () => peer.destroy(),
      }),
    );
    peer.on('error', (err) => reject(new Error(`Couldn't create the lobby (${err.type ?? err.message})`)));
  });
}

/** Join a host by invite code. */
export function connectToHost(code: string): Promise<Connection> {
  return new Promise((resolve, reject) => {
    const peer = new Peer();
    const timer = setTimeout(() => {
      peer.destroy();
      reject(new Error("Couldn't reach the lobby. Check the link, or ask the host if it's still open."));
    }, CONNECT_TIMEOUT);
    peer.on('error', (err) => {
      clearTimeout(timer);
      peer.destroy();
      reject(
        new Error(
          err.type === 'peer-unavailable'
            ? 'That lobby doesn\'t exist any more.'
            : `Couldn't connect (${err.type ?? err.message})`,
        ),
      );
    });
    peer.on('open', () => {
      const dc = peer.connect(ID_PREFIX + code, { reliable: true, serialization: 'json' });
      dc.on('open', () => {
        clearTimeout(timer);
        const conn = wrap(dc);
        const close = conn.close;
        resolve({ ...conn, close: () => (close(), peer.destroy()) });
      });
    });
  });
}
