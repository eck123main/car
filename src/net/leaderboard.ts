import { RealtimeClient, type RealtimeChannel } from '@supabase/realtime-js';
import { isGhost, type Ghost } from '../sim/ghost';
import { accounts } from './accounts';

/** One player's best lap on a track. */
export interface TimeEntry {
  /** Random id for this browser, so two players with the same name stay apart. */
  player: string;
  name: string;
  time: number;
  sectors: number[];
}

/**
 * Where time trial laps are kept. Global (a free Supabase database, see
 * `supabase/time_trial.sql`) when the build has its URL and key, otherwise only in this
 * browser.
 */
export interface Leaderboard {
  readonly global: boolean;
  /** Best lap per player on a track, fastest first. */
  top(track: string, limit?: number): Promise<TimeEntry[]>;
  /** A player's best lap as a ghost, if there is one. */
  ghostOf(track: string, player: string): Promise<Ghost | null>;
  /** Save a personal best lap with its ghost (so whoever holds the record has one). */
  submit(track: string, entry: TimeEntry, ghost: Ghost | null): Promise<void>;
  /**
   * Call `onChange` whenever someone else saves a lap on this track, so everyone driving it
   * sees a new record straight away. Returns a function that stops watching.
   */
  watch(track: string, onChange: () => void): () => void;
}

const PLAYER_KEY = 'f1td.player';

/** The signed-in account's id, else this browser's guest id (made up once and remembered). */
export function playerId(): string {
  const account = accounts()?.account();
  if (account) return account.id;
  try {
    let id = localStorage.getItem(PLAYER_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(PLAYER_KEY, id);
    }
    return id;
  } catch {
    return 'guest';
  }
}

/** The key/value storage the local leaderboard uses (localStorage in the browser). */
export interface KeyValue {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function read<T>(kv: KeyValue, key: string): T | null {
  try {
    const raw = kv.getItem(key);
    return raw === null ? null : (JSON.parse(raw) as T);
  } catch {
    return null;
  }
}

function write(kv: KeyValue, key: string, value: unknown): void {
  try {
    kv.setItem(key, JSON.stringify(value));
  } catch {
    // Full or blocked storage: the time just isn't kept.
  }
}

/** Times kept in this browser only. */
export class LocalLeaderboard implements Leaderboard {
  readonly global = false;
  constructor(private readonly kv: KeyValue) {}

  async top(track: string, limit = 10): Promise<TimeEntry[]> {
    return (read<TimeEntry[]>(this.kv, `f1td.tt.${track}`) ?? []).slice(0, limit);
  }

  async ghostOf(track: string, player: string): Promise<Ghost | null> {
    const g = read<unknown>(this.kv, `f1td.tt.ghost.${track}.${player}`);
    return isGhost(g) ? g : null;
  }

  async submit(track: string, entry: TimeEntry, ghost: Ghost | null): Promise<void> {
    const all = read<TimeEntry[]>(this.kv, `f1td.tt.${track}`) ?? [];
    const merged = mergeBest(all, entry);
    write(this.kv, `f1td.tt.${track}`, merged);
    if (ghost && merged.includes(entry)) write(this.kv, `f1td.tt.ghost.${track}.${entry.player}`, ghost);
  }

  /** Other tabs of this browser (the only other players a local board has). */
  watch(track: string, onChange: () => void): () => void {
    if (typeof window === 'undefined') return () => {};
    const listener = (e: StorageEvent) => {
      if (e.key === `f1td.tt.${track}`) onChange();
    };
    window.addEventListener('storage', listener);
    return () => window.removeEventListener('storage', listener);
  }
}

/** Keep each player's best only, fastest first. */
export function mergeBest(entries: TimeEntry[], entry: TimeEntry): TimeEntry[] {
  const old = entries.find((e) => e.player === entry.player);
  if (old && old.time <= entry.time) return entries;
  return [...entries.filter((e) => e.player !== entry.player), entry].sort((a, b) => a.time - b.time);
}

/**
 * Times shared by everyone, in a Supabase database (free tier, talked to over its REST API).
 * New laps are announced on a Realtime broadcast channel per track. The message only says
 * "a lap was saved": everyone then reads the board from the database, so a made-up message
 * can't put a fake time on anyone's screen.
 */
export class SupabaseLeaderboard implements Leaderboard {
  readonly global = true;
  private realtime: RealtimeClient | null = null;
  private readonly channels = new Map<string, RealtimeChannel>();
  constructor(
    private readonly url: string,
    private readonly key: string,
  ) {}

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(`${this.url}/rest/v1/${path}`, { headers: { apikey: this.key } });
    if (!res.ok) throw new Error(`Leaderboard: ${res.status} ${await res.text()}`);
    return (await res.json()) as T;
  }

  async top(track: string, limit = 10): Promise<TimeEntry[]> {
    const rows = await this.get<TimeEntry[]>(
      `time_trial_best?select=player,name,time,sectors&track=eq.${encodeURIComponent(track)}&order=time.asc&limit=${limit}`,
    );
    return rows.map((r) => ({ ...r, sectors: Array.isArray(r.sectors) ? r.sectors : [] }));
  }

  async ghostOf(track: string, player: string): Promise<Ghost | null> {
    const rows = await this.get<{ ghost: unknown }[]>(
      `time_trial?select=ghost&track=eq.${encodeURIComponent(track)}&player=eq.${encodeURIComponent(player)}` +
        '&ghost=not.is.null&order=time.asc&limit=1',
    );
    const g = rows[0]?.ghost;
    return isGhost(g) ? g : null;
  }

  async submit(track: string, entry: TimeEntry, ghost: Ghost | null): Promise<void> {
    const service = accounts();
    const account = service?.account();
    if (service && account && account.id === entry.player) {
      // Signed in: the database puts the lap under the account (nobody else can).
      await service.rpc('submit_lap', { p_token: account.token, p_track: track, p_time: entry.time, p_sectors: entry.sectors, p_ghost: ghost });
    } else {
      const res = await fetch(`${this.url}/rest/v1/time_trial`, {
        method: 'POST',
        headers: { apikey: this.key, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ track, ...entry, ghost }),
      });
      if (!res.ok) throw new Error(`Leaderboard: ${res.status} ${await res.text()}`);
    }
    // Tell everyone on this track (an announcement that doesn't arrive just waits for their next poll).
    void this.channels
      .get(track)
      ?.send({ type: 'broadcast', event: LAP_EVENT, payload: {} })
      .catch(() => {});
  }

  watch(track: string, onChange: () => void): () => void {
    try {
      this.realtime ??= new RealtimeClient(`${this.url}/realtime/v1`, { params: { apikey: this.key } });
      const channel = this.realtime.channel(`time_trial:${track}`, { config: { broadcast: { self: false } } });
      channel.on('broadcast', { event: LAP_EVENT }, () => onChange()).subscribe();
      this.channels.set(track, channel);
      return () => {
        if (this.channels.get(track) === channel) this.channels.delete(track);
        void this.realtime?.removeChannel(channel);
      };
    } catch (err) {
      // No live updates then; the board still refreshes now and then.
      console.warn(err);
      return () => {};
    }
  }
}

/** The broadcast sent when a lap is saved. */
const LAP_EVENT = 'lap';

/** localStorage, but never throwing (it can be blocked). */
const browserKv: KeyValue = {
  getItem: (k) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  setItem: (k, v) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      // Not kept.
    }
  },
};

let shared: Leaderboard | null = null;

/** The leaderboard for this build: global if a database is configured, else this browser. */
export function leaderboard(): Leaderboard {
  if (shared) return shared;
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_KEY as string | undefined;
  shared = url && key ? new SupabaseLeaderboard(url.replace(/\/$/, ''), key) : new LocalLeaderboard(browserKv);
  return shared;
}

/** Where a player's personal best ghost is kept (guests keep the original key). */
function personalKey(track: string, player: string): string {
  return accounts()?.account()?.id === player ? `f1td.tt.pb.${player}.${track}` : `f1td.tt.pb.${track}`;
}

/** Personal best ghosts are always kept locally too, whatever the leaderboard is. */
export function loadPersonalGhost(track: string, player = playerId()): Ghost | null {
  const g = read<unknown>(browserKv, personalKey(track, player));
  return isGhost(g) ? g : null;
}

export function savePersonalGhost(ghost: Ghost, player = playerId()): void {
  write(browserKv, personalKey(ghost.track, player), ghost);
}
