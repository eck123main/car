import Peer, { type DataConnection } from 'peerjs';
import type { Connection, HostTransport } from './transport';

/**
 * WebRTC transport via PeerJS. The free public PeerJS server only introduces the
 * browsers to each other; game traffic then goes directly between them.
 */
const ID_PREFIX = 'f1td-';
const CONNECT_TIMEOUT = 15_000;
/**
 * The fast channel: a second data channel on the same connection, unordered and never resent
 * (PeerJS's own "unreliable" mode still resends). Both ends create it with this fixed id, so it
 * needs no extra signalling. PeerJS's channel takes a low id.
 */
const FAST_CHANNEL_ID = 100;
/** Fast messages are dropped rather than queued when this much (bytes) is still waiting to go. */
const FAST_BUFFER_LIMIT = 64 * 1024;

function randomCode(): string {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function wrap(conn: DataConnection): Connection {
  const outbox: unknown[] = [];
  const handlers: ((msg: unknown) => void)[] = [];
  let open = conn.open;
  let fast: RTCDataChannel | null = null;
  const openFast = () => {
    const pc = conn.peerConnection;
    if (fast || !pc) return;
    try {
      fast = pc.createDataChannel('fast', { negotiated: true, id: FAST_CHANNEL_ID, ordered: false, maxRetransmits: 0 });
    } catch {
      return; // Everything goes over the reliable channel then.
    }
    fast.onmessage = (e) => {
      let msg: unknown;
      try {
        msg = JSON.parse(e.data as string);
      } catch {
        return;
      }
      for (const h of handlers) h(msg);
    };
  };
  if (open) openFast();
  conn.on('open', () => {
    open = true;
    openFast();
    for (const m of outbox.splice(0)) conn.send(m);
  });
  conn.on('data', (msg) => {
    for (const h of handlers) h(msg);
  });
  const send = (msg: unknown) => (open ? conn.send(msg) : outbox.push(msg));
  return {
    send,
    sendFast: (msg) => {
      if (fast?.readyState !== 'open') send(msg);
      // A congested link: drop it, the next one is due in a moment anyway.
      else if (fast.bufferedAmount < FAST_BUFFER_LIMIT) fast.send(JSON.stringify(msg));
    },
    onMessage: (cb) => handlers.push(cb),
    onClose: (cb) => {
      conn.on('close', cb);
      conn.on('error', cb);
    },
    close: () => conn.close(),
    route: () => route(conn.peerConnection),
  };
}

/** Whether WebRTC is using a relay (TURN) server: the active candidate pair has a relay end. */
async function route(pc: RTCPeerConnection | undefined): Promise<'direct' | 'relayed' | null> {
  if (!pc) return null;
  try {
    const stats = await pc.getStats();
    let pairId: string | undefined;
    stats.forEach((s) => {
      if (s.type === 'transport' && s.selectedCandidatePairId) pairId = s.selectedCandidatePairId;
    });
    let pair: RTCIceCandidatePairStats | undefined;
    stats.forEach((s) => {
      if (s.type !== 'candidate-pair') return;
      if (pairId ? s.id === pairId : s.nominated && s.state === 'succeeded') pair = s;
    });
    if (!pair) return null;
    const types = [stats.get(pair.localCandidateId)?.candidateType, stats.get(pair.remoteCandidateId)?.candidateType];
    return types.includes('relay') ? 'relayed' : 'direct';
  } catch {
    return null;
  }
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
