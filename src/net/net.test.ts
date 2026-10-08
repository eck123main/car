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
