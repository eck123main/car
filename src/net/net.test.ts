import { describe, expect, it } from 'vitest';
import { botInput } from '../sim/bot';
import { IDLE_INPUT } from '../sim/world';
import { TRACKS } from '../tracks';
import { ClientGame } from './client';
import { HostGame } from './host';
import { MAX_PLAYERS } from './protocol';
import { LoopbackNetwork } from './transport';

const DT = 1 / 120;
/** Test players are always ready on the grid. */
const READY = { ...IDLE_INPUT, ready: true };

function setup(latency = 0, fastLoss = 0, fastJitter = 0) {
  const net = new LoopbackNetwork(latency, fastLoss, fastJitter);
  let clock = 0;
  const host = new HostGame(net.host('ABC'), 'Hosty', (id) => TRACKS[id], () => clock);
  const join = (name: string) => new ClientGame(net.connect('ABC'), name, () => clock);
  const tick = (dt = DT) => {
    clock += dt;
    net.advance(dt);
  };
  return { net, host, join, tick };
}

describe('Ping', () => {
  it('measures each round trip and shares it with everyone, in the lobby and the race', () => {
    // 50 ms each way: a 100 ms round trip.
    const { host, join, tick } = setup(0.05);
    const a = join('Alice');
    const b = join('Bob');
    for (let t = 0; t < 3; t += DT) {
      host.tickNet();
      tick();
    }
    const pingOf = (net: { id: string; ping: number | null }[], id: string) => net.find((n) => n.id === id)?.ping ?? null;
    expect(pingOf(host.net, a.id!)).toBeCloseTo(100, -1);
    // Everyone sees everyone's ping; the host has none of its own.
    expect(pingOf(b.net, a.id!)).toBeCloseTo(100, -1);
    expect(pingOf(a.net, b.id!)).toBeCloseTo(100, -1);
    expect(pingOf(a.net, HostGame.HOST_ID)).toBeNull();
    // Racing: the race loop keeps it going.
    host.updateSettings({ trackId: 'test', qualifying: false });
    host.start();
    const before = host.net.find((n) => n.id === a.id)!;
    for (let t = 0; t < 2; t += DT) {
      host.step(DT, READY);
      a.step(DT, READY);
      b.step(DT, READY);
      a.flush();
      b.flush();
      tick();
    }
    expect(pingOf(a.net, a.id!)).toBeCloseTo(100, -1);
    expect(host.net.find((n) => n.id === a.id)).not.toBe(before);
  });
});

describe('Lobby', () => {
  it('lets players join with their name and a unique colour', () => {
    const { host, join, tick } = setup();
    const a = join('Alice');
    const b = join('  Bob  ');
    tick();
    tick();
    expect(a.status).toBe('lobby');
    expect(b.lobby?.players.map((p) => p.name)).toEqual(['Hosty', 'Alice', 'Bob']);
    const colors = host.lobby.players.map((p) => p.color);
    expect(new Set(colors).size).toBe(3);
    expect(host.lobby.players[0].host).toBe(true);
  });

  it('sends the host\'s settings to everyone', () => {
    const { host, join, tick } = setup();
    const a = join('Alice');
    tick();
    host.updateSettings({ laps: 12, weather: 'rain' });
    tick();
    expect(a.lobby?.settings.laps).toBe(12);
    expect(a.lobby?.settings.weather).toBe('rain');
  });

  it('turns players away when full, even mid-race', () => {
    const { host, join, tick } = setup();
    const clients = Array.from({ length: MAX_PLAYERS }, (_, i) => join(`P${i}`));
    tick();
    tick();
    expect(clients.filter((c) => c.status === 'lobby')).toHaveLength(MAX_PLAYERS - 1);
    expect(clients[MAX_PLAYERS - 1].status).toBe('rejected');
    host.start();
    const late = join('Late');
    tick();
    tick();
    expect(late.status).toBe('rejected');
    expect(late.rejectReason).toMatch(/full/i);
  });
});

describe('Online race', () => {
  it('starts for everyone and keeps the client\'s predicted car in sync', () => {
    const { host, join, tick } = setup(0.05);
    const c = join('Alice');
    for (let i = 0; i < 20; i++) tick();
    host.updateSettings({ trackId: 'test', qualifying: false, laps: 2 });
    host.start();
    for (let i = 0; i < 20; i++) tick();
    expect(c.status).toBe('racing');
    expect(c.world?.racers).toHaveLength(2);

    let maxCorrection = 0;
    for (let t = 0; t < 25; t += DT) {
      const session = host.session!;
      const waiting = session.phase === 'grid' || session.phase === 'lights';
      host.step(DT, { ...botInput(session.track, session.world.racer(HostGame.HOST_ID)!, { hold: waiting }), ready: true });
      const me = c.me;
      const cWaiting = c.session?.phase !== 'race';
      c.step(DT, me && c.track ? { ...botInput(c.track, me, { hold: cWaiting, offset: 3 }), ready: true } : READY);
      c.flush();
      tick();
      if (session.phase === 'race' && session.world.time - session.raceStart > 2) {
        maxCorrection = Math.max(maxCorrection, c.lastCorrection);
      }
    }
    const hostView = host.session!.world.racer(c.id!)!;
    expect(host.session!.progress(hostView)).toBeGreaterThan(200);
    // Prediction ran (some correction happened) and stayed close to the host.
    expect(maxCorrection).toBeGreaterThan(0);
    expect(maxCorrection).toBeLessThan(1);
    // The client sees the host's car too.
    expect(c.pose(HostGame.HOST_ID, DT)).not.toBeNull();
    expect(c.session?.phase).toBe('race');
  });

  it("a client's DRS works: the host opens it, and the client sees it and drives with it", () => {
    const { host, join, tick } = setup(0.05);
    const c = join('Alice');
    for (let i = 0; i < 20; i++) tick();
    host.updateSettings({ trackId: 'test', qualifying: false, laps: 4 });
    host.start();
    for (let i = 0; i < 20; i++) tick();
    let hostSawOpen = false;
    let clientSawOpen = false;
    let clientDrag = 1;
    for (let t = 0; t < 90 && host.session!.phase !== 'finished'; t += DT) {
      const session = host.session!;
      const waiting = session.phase === 'grid' || session.phase === 'lights';
      host.step(DT, { ...botInput(session.track, session.world.racer(HostGame.HOST_ID)!, { hold: waiting }), ready: true });
      const me = c.me;
      const cWaiting = c.session?.phase !== 'race';
      // The client follows the host round, holding DRS the whole time.
      c.step(DT, me && c.track ? { ...botInput(c.track, me, { hold: cWaiting }), drs: true, ready: true } : READY);
      c.flush();
      tick();
      hostSawOpen ||= session.world.racer(c.id!)!.drsOpen;
      clientSawOpen ||= !!c.me?.drsOpen;
      if (c.me) clientDrag = Math.min(clientDrag, c.me.car.dragFactor);
    }
    expect(hostSawOpen).toBe(true);
    expect(clientSawOpen).toBe(true);
    // The client's own (predicted) car gets the lower drag too.
    expect(clientDrag).toBeLessThan(0.7);
  });

  it('shows the safety car and its rules to a client', () => {
    const { host, join, tick } = setup(0.05);
    const c = join('Alice');
    for (let i = 0; i < 20; i++) tick();
    host.updateSettings({ trackId: 'test', qualifying: false, laps: 5 });
    host.start();
    for (let i = 0; i < 20; i++) tick();
    let wrecked = false;
    let sawSafetyCar = false;
    let sawPose = false;
    let sawRule = false;
    for (let t = 0; t < 40; t += DT) {
      const session = host.session!;
      const waiting = session.phase === 'grid' || session.phase === 'lights';
      // A few seconds into the race, the host crashes out.
      if (!wrecked && session.phase === 'race' && session.world.time - session.raceStart > 5) {
        session.world.racer(HostGame.HOST_ID)!.car.retired = true;
        wrecked = true;
      }
      host.step(DT, { ...botInput(session.track, session.world.racer(HostGame.HOST_ID)!, { hold: waiting }), ready: true });
      const me = c.me;
      c.step(DT, me && c.track ? { ...botInput(c.track, me, { hold: c.session?.phase !== 'race' }), ready: true } : READY);
      c.flush();
      tick();
      sawSafetyCar ||= c.session?.safetyCar === 'deployed';
      sawPose ||= c.session?.safetyCar != null && c.safetyCarPose() !== null;
      sawRule ||= c.session?.noOvertaking.includes(c.id!) ?? false;
    }
    expect(sawSafetyCar).toBe(true);
    expect(sawPose).toBe(true);
    expect(sawRule).toBe(true);
  });

  it('retires a driver who disconnects mid-race', () => {
    const { host, join, tick } = setup();
    const c = join('Alice');
    tick();
    host.updateSettings({ trackId: 'test', qualifying: false });
    host.start();
    tick();
    c.close();
    tick();
    expect(host.session!.world.racer(c.id!)!.car.retired).toBe(true);
  });
});

describe('Bots in an online lobby', () => {
  it('shows bots to everyone, counts them towards the limit, and races them on the host', () => {
    const { host, join, tick } = setup();
    const c = join('Alice');
    tick();
    expect(host.addBot('hard')).toBe(true);
    expect(host.addBot('easy')).toBe(true);
    tick();
    const bots = c.lobby!.players.filter((p) => p.bot);
    expect(bots.map((b) => b.bot)).toEqual(['hard', 'easy']);
    expect(new Set(c.lobby!.players.map((p) => p.color)).size).toBe(4);
    // Fill up: host + Alice + bots = 10.
    for (let i = 0; i < 6; i++) expect(host.addBot('medium')).toBe(true);
    expect(host.addBot('medium')).toBe(false);
    const late = join('Late');
    tick();
    tick();
    expect(late.status).toBe('rejected');
    host.removeBot(bots[0].id);
    expect(host.lobby.players).toHaveLength(9);

    host.updateSettings({ trackId: 'test', qualifying: false, laps: 2 });
    host.start();
    for (let t = 0; t < 20; t += DT) {
      host.step(DT, READY);
      c.step(DT, READY);
      c.flush();
      tick();
    }
    const session = host.session!;
    expect(session.phase).toBe('race');
    const botRacers = session.world.racers.filter((r) => r.id.startsWith('bot'));
    expect(botRacers).toHaveLength(7);
    // The bots are off the line and racing; the client sees them move.
    for (const r of botRacers) expect(session.progress(r)).toBeGreaterThan(50);
    expect(c.pose(botRacers[0].id, DT)).not.toBeNull();
  });
});

describe('Reset over the network', () => {
  it("a client's R reaches the host", () => {
    const { host, join, tick } = setup();
    const c = join('Alice');
    tick();
    host.updateSettings({ trackId: 'test', qualifying: false });
    host.start();
    for (let t = 0; t < 14; t += DT) {
      host.step(DT, READY);
      c.step(DT, READY);
      c.flush();
      tick();
    }
    const racer = host.session!.world.racer(c.id!)!;
    racer.car.impact(30, 2.6, 0);
    expect(racer.car.retired).toBe(true);
    c.step(DT, { ...IDLE_INPUT, reset: true });
    c.flush();
    for (let t = 0; t < 5.2; t += DT) {
      tick();
      host.step(DT, READY);
    }
    expect(racer.car.retired).toBe(false);
  });
});

describe('Lag', () => {
  it('never loses an R press when a client sends a backlog of inputs', () => {
    const { host, join, tick } = setup();
    const c = join('Alice');
    tick();
    host.updateSettings({ trackId: 'test', qualifying: false });
    host.start();
    // The client is ready on the grid, then goes quiet.
    tick();
    c.step(DT, READY);
    c.flush();
    for (let t = 0; t < 14; t += DT) {
      host.step(DT, READY);
      tick();
    }
    const racer = host.session!.world.racer(c.id!)!;
    racer.car.impact(30, 2.6, 0);
    // A lag spike: 30 inputs arrive at once, the R press among the oldest.
    for (let i = 0; i < 30; i++) c.step(DT, { ...IDLE_INPUT, reset: i === 2 });
    c.flush();
    tick();
    for (let t = 0; t < 5.5; t += DT) host.step(DT, READY);
    expect(racer.car.retired).toBe(false);
  });
});

describe('Packet loss', () => {
  it('keeps the race in sync when a fifth of snapshots and inputs are lost or arrive out of order', () => {
    const { host, join, tick } = setup(0.05, 0.2, 0.03);
    const c = join('Alice');
    for (let i = 0; i < 20; i++) tick();
    host.updateSettings({ trackId: 'test', qualifying: false, laps: 2 });
    host.start();
    for (let i = 0; i < 20; i++) tick();
    expect(c.status).toBe('racing');

    let maxCorrection = 0;
    for (let t = 0; t < 25; t += DT) {
      const session = host.session!;
      const waiting = session.phase === 'grid' || session.phase === 'lights';
      host.step(DT, { ...botInput(session.track, session.world.racer(HostGame.HOST_ID)!, { hold: waiting }), ready: true });
      const me = c.me;
      const cWaiting = c.session?.phase !== 'race';
      c.step(DT, me && c.track ? { ...botInput(c.track, me, { hold: cWaiting, offset: 3 }), ready: true } : READY);
      c.flush();
      tick();
      if (session.phase === 'race' && session.world.time - session.raceStart > 2) {
        maxCorrection = Math.max(maxCorrection, c.lastCorrection);
      }
    }
    // Lost inputs are covered by the copies in the next packets, so the host drives the
    // client's car just as the client predicted it.
    expect(host.session!.progress(host.session!.world.racer(c.id!)!)).toBeGreaterThan(200);
    expect(maxCorrection).toBeLessThan(1);
  });

  it("drains a backlog of queued inputs, so a player's car doesn't stay behind their keys", () => {
    const { host, join, tick } = setup();
    const c = join('Alice');
    tick();
    host.updateSettings({ trackId: 'test', qualifying: false });
    host.start();
    tick();
    const queue = () => (host as unknown as { remotes: Map<string, { queue: unknown[] }> }).remotes.get(c.id!)!.queue.length;
    // A hitch on the client: a burst of inputs, then one per step again.
    for (let i = 0; i < 8; i++) c.step(DT, READY);
    c.flush();
    tick();
    host.step(DT, READY);
    expect(queue()).toBeGreaterThan(5);
    for (let t = 0; t < 5; t += DT) {
      c.step(DT, READY);
      c.flush();
      tick();
      host.step(DT, READY);
    }
    expect(queue()).toBeLessThanOrEqual(2);
  });

  it('never loses an R press, even when packets are dropped', () => {
    const { host, join, tick } = setup(0.02, 0.4, 0.01);
    const c = join('Alice');
    for (let i = 0; i < 10; i++) tick();
    host.updateSettings({ trackId: 'test', qualifying: false });
    host.start();
    for (let t = 0; t < 14; t += DT) {
      c.step(DT, READY);
      c.flush();
      host.step(DT, READY);
      tick();
    }
    const racer = host.session!.world.racer(c.id!)!;
    expect(host.session!.phase).toBe('race');
    for (let attempt = 0; attempt < 5; attempt++) {
      racer.car.impact(30, 2.6, 0);
      for (let t = 0; t < 6; t += DT) {
        c.step(DT, { ...IDLE_INPUT, reset: t < DT / 2 });
        c.flush();
        host.step(DT, READY);
        tick();
      }
      expect(racer.car.retired).toBe(false);
    }
  });
});

describe('Spectators', () => {
  it('someone who joins mid-race watches it, then races in the next weekend', () => {
    const { host, join, tick } = setup();
    const a = join('Alice');
    tick();
    host.updateSettings({ trackId: 'test', qualifying: false });
    host.start();
    for (let t = 0; t < 3; t += DT) {
      host.step(DT, READY);
      tick();
    }
    const late = join('Late');
    for (let i = 0; i < 40; i++) {
      host.step(DT, READY);
      tick();
    }
    // In straight away, watching the race: the track, every car and the timing, but no car of its own.
    expect(late.status).toBe('racing');
    expect(late.world!.racers.map((r) => r.id).sort()).toEqual(['host', a.id!].sort());
    expect(late.me).toBeUndefined();
    expect(late.session?.phase).toBe(host.session!.phase);
    expect(late.pose('host', DT)).not.toBeNull();
    // Its (idle) inputs don't upset the race.
    late.step(DT, READY);
    late.flush();
    host.step(DT, READY);
    tick();
    expect(host.session!.world.racers).toHaveLength(2);
    // Next weekend it has a car.
    host.start();
    for (let i = 0; i < 5; i++) {
      host.step(DT, READY);
      tick();
    }
    expect(host.session!.world.racers.map((r) => r.id)).toContain(late.id);
    expect(late.me).toBeDefined();
  });
});

describe('Play again', () => {
  it('restarts the weekend for everyone in the lobby', () => {
    const { host, join, tick } = setup();
    const c = join('Alice');
    tick();
    host.addBot('easy');
    host.updateSettings({ trackId: 'test', qualifying: false });
    host.start();
    for (let t = 0; t < 2; t += DT) {
      host.step(DT, READY);
      tick();
    }
    const first = host.session;
    host.start();
    for (let i = 0; i < 5; i++) {
      host.step(DT, READY);
      tick();
    }
    expect(host.session).not.toBe(first);
    expect(host.session!.world.racers).toHaveLength(3);
    expect(c.status).toBe('racing');
    expect(c.world!.racers.map((r) => r.id).sort()).toEqual(host.session!.world.racers.map((r) => r.id).sort());
    expect(c.session?.phase).toBe('grid');
  });
});
