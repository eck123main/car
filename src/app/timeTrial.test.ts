import { describe, expect, it } from 'vitest';
import type { Leaderboard, TimeEntry } from '../net/leaderboard';
import { Track } from '../track/track';
import { TRACKS } from '../tracks';
import { medalTimes } from '../sim/medals';
import { TimeTrialDriver } from './timeTrial';

/** A shared board that another player can add a lap to, announcing it like the real one. */
function sharedBoard() {
  const rows: TimeEntry[] = [{ player: 'other', name: 'Ann', time: 50, sectors: [] }];
  const watchers: (() => void)[] = [];
  const store: Leaderboard = {
    global: true,
    top: async () => [...rows].sort((a, b) => a.time - b.time),
    bestsOf: async () => ({}),
    ghostOf: async () => null,
    submit: async () => {},
    watch: (_track, onChange) => {
      watchers.push(onChange);
      return () => watchers.splice(watchers.indexOf(onChange), 1);
    },
  };
  const someoneSets = (entry: TimeEntry) => {
    rows.push(entry);
    for (const w of watchers) w();
  };
  return { store, someoneSets, watchers };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe('Time trial leaderboard', () => {
  it("shows another player's new record at once, without waiting for a reload", async () => {
    const { store, someoneSets } = sharedBoard();
    const driver = new TimeTrialDriver(new Track(TRACKS.test), 'test', 'Me', store);
    await settle();
    const view = driver as unknown as { board: TimeEntry[]; notice: { text: string } | null };
    expect(view.board.map((e) => e.name)).toEqual(['Ann']);

    someoneSets({ player: 'third', name: 'Bob', time: 48.5, sectors: [] });
    await settle();
    expect(view.board.map((e) => e.name)).toEqual(['Bob', 'Ann']);
    expect(view.notice?.text).toContain('NEW RECORD: Bob');
  });

  it('stops listening when the player leaves the track', async () => {
    const { store, watchers } = sharedBoard();
    const driver = new TimeTrialDriver(new Track(TRACKS.test), 'test', 'Me', store);
    expect(watchers).toHaveLength(1);
    driver.dispose();
    expect(watchers).toHaveLength(0);
  });
});

describe('Time trial ghost', () => {
  /** A finished lap as the time trial reports it (a short ghost along the start). */
  const lap = (time: number) => {
    const s = new Track(TRACKS.test).samples;
    const pts = s.slice(0, 5);
    return { time, sectors: [], ghost: { track: 'test', name: 'Me', time, dt: 0.05, x: pts.map((p) => p.x), y: pts.map((p) => p.y), h: pts.map(() => 0) } };
  };
  type View = { ghostKey(): string; lapDone(l: ReturnType<typeof lap>): void; player: string };

  it("races the record holder's ghost, then our own once we take the record", async () => {
    const { store } = sharedBoard();
    const driver = new TimeTrialDriver(new Track(TRACKS.test), 'test', 'Me', store);
    await settle();
    const view = driver as unknown as View;
    expect(view.ghostKey()).toBe('other');
    view.lapDone(lap(51));
    expect(view.ghostKey()).toBe('other');
    view.lapDone(lap(49));
    expect(view.ghostKey()).toBe('personal');
  });

  it("replaces our own ghost with the board's when the board has a faster lap of ours", async () => {
    const { store, someoneSets } = sharedBoard();
    const driver = new TimeTrialDriver(new Track(TRACKS.test), 'test', 'Me', store, 'personal');
    await settle();
    const view = driver as unknown as View & { personal: { ghost: { time: number } } | null };
    view.lapDone(lap(51));
    expect(view.personal?.ghost.time).toBe(51);
    // A faster lap of ours from another device: its ghost is on the board.
    store.ghostOf = async (_track, player) => (player === view.player ? lap(47).ghost : null);
    someoneSets({ player: view.player, name: 'Me', time: 47, sectors: [] });
    await settle();
    await settle();
    expect(view.personal?.ghost.time).toBe(47);
  });

  it('moves on to the next player up after beating the chosen ghost', async () => {
    const { store, someoneSets } = sharedBoard();
    someoneSets({ player: 'third', name: 'Bob', time: 53, sectors: [] });
    const driver = new TimeTrialDriver(new Track(TRACKS.test), 'test', 'Me', store, 'third');
    await settle();
    const view = driver as unknown as View;
    expect(view.ghostKey()).toBe('third');
    view.lapDone(lap(52));
    expect(view.ghostKey()).toBe('other');
  });
});

describe('Time trial medals', () => {
  const times = medalTimes('silverstone')!;
  const lap = (time: number) => {
    const s = new Track(TRACKS.silverstone).samples.slice(0, 5);
    return { time, sectors: [], ghost: { track: 'silverstone', name: 'Me', time, dt: 0.05, x: s.map((p) => p.x), y: s.map((p) => p.y), h: s.map(() => 0) } };
  };
  type View = { lapDone(l: ReturnType<typeof lap>): void; notice: { text: string } | null };
  const drive = (signedIn: boolean) =>
    new TimeTrialDriver(new Track(TRACKS.silverstone), 'silverstone', 'Me', sharedBoard().store, 'off', signedIn) as unknown as View;

  it('awards a medal to a signed-in player, only when it is a better one', async () => {
    const view = drive(true);
    await settle();
    view.lapDone(lap(times.silver - 0.1));
    expect(view.notice?.text).toContain('SILVER MEDAL!');
    view.lapDone(lap(times.silver - 0.2));
    expect(view.notice?.text).not.toContain('MEDAL');
    view.lapDone(lap(times.author));
    expect(view.notice?.text).toContain('AUTHOR MEDAL!');
  });

  it('tells a guest to sign in instead', async () => {
    const view = drive(false);
    await settle();
    view.lapDone(lap(times.gold - 0.1));
    expect(view.notice?.text).toContain('sign in to earn medals');
    expect(view.notice?.text).not.toContain('MEDAL!');
  });
});
