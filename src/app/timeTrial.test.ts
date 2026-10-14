import { describe, expect, it } from 'vitest';
import type { Leaderboard, TimeEntry } from '../net/leaderboard';
import { Track } from '../track/track';
import { TRACKS } from '../tracks';
import { TimeTrialDriver } from './timeTrial';

/** A shared board that another player can add a lap to, announcing it like the real one. */
function sharedBoard() {
  const rows: TimeEntry[] = [{ player: 'other', name: 'Ann', time: 50, sectors: [] }];
  const watchers: (() => void)[] = [];
  const store: Leaderboard = {
    global: true,
    top: async () => [...rows].sort((a, b) => a.time - b.time),
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
