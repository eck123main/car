import { describe, expect, it } from 'vitest';
import { botInput } from '../sim/bot';
import { IDLE_INPUT } from '../sim/world';
import { TRACKS } from '../tracks';
import { ClientGame } from './client';
import { HostGame } from './host';
import { MAX_PLAYERS } from './protocol';
import { LoopbackNetwork } from './transport';

const DT = 1 / 120;

function setup(latency = 0) {
  const net = new LoopbackNetwork(latency);
  let clock = 0;
  const host = new HostGame(net.host('ABC'), 'Hosty', (id) => TRACKS[id]);
  const join = (name: string) => new ClientGame(net.connect('ABC'), name, () => clock);
  const tick = (dt = DT) => {
    clock += dt;
    net.advance(dt);
  };
  return { net, host, join, tick };
}

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

  it('turns players away when full or mid-race', () => {
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
    expect(late.rejectReason).toMatch(/race/i);
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
      host.step(DT, botInput(session.track, session.world.racer(HostGame.HOST_ID)!, { hold: waiting }));
      const me = c.me;
      const cWaiting = c.session?.phase !== 'race';
      c.step(DT, me && c.track ? botInput(c.track, me, { hold: cWaiting, offset: 3 }) : IDLE_INPUT);
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
      host.step(DT, IDLE_INPUT);
      c.step(DT, IDLE_INPUT);
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
      host.step(DT, IDLE_INPUT);
      c.step(DT, IDLE_INPUT);
      c.flush();
      tick();
    }
    const racer = host.session!.world.racer(c.id!)!;
    racer.car.impact(30, 2.6, 0);
    expect(racer.car.retired).toBe(true);
    c.step(DT, { ...IDLE_INPUT, reset: true });
    c.flush();
    for (let i = 0; i < 4; i++) {
      tick();
      host.step(DT, IDLE_INPUT);
    }
    expect(racer.car.retired).toBe(false);
  });
});
