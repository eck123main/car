import { medalCounts, RARITY_COLORS, RARITY_NAMES, skinDef, SKINS, skinUnlocked, TEAM_SKIN, type MedalCounts, type SkinDef } from '../cosmetics/skins';
import type { AccountService } from '../net/accounts';
import { playerId, type Leaderboard } from '../net/leaderboard';
import { DAILY_REWARDS, prizeText, SPIN_PRIZES, wallet, type Wallet } from '../net/wallet';
import { F1_CAR } from '../physics/carParams';
import { drawCar } from '../render/drawCar';
import { formatLapTime } from '../render/hud';
import { MEDAL_COLORS, MEDAL_NAMES, MEDALS, medalFor, medalTimes, type Medal } from '../sim/medals';
import { coins, el, show, showSignIn } from './ui';

export interface GarageView {
  accounts: AccountService | null;
  board: Leaderboard;
  /** Tracks medals can be won on. */
  tracks: { id: string; name: string }[];
  onBack: () => void;
}

type Tab = 'daily' | 'skins' | 'medals';
const TABS: [Tab, string][] = [
  ['daily', 'Daily'],
  ['skins', 'Skins'],
  ['medals', 'Medals'],
];

function duration(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** A car in a skin, drawn on a little canvas, nose to the right. */
export function skinPreview(skin: SkinDef, color = '#e10600', width = 150, height = 64): HTMLCanvasElement {
  const canvas = el('canvas', { class: 'skin-preview' });
  const dpr = window.devicePixelRatio || 1;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const scale = (width * 0.8) / (F1_CAR.length + 1);
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, (width / 2) * dpr, (height / 2) * dpr);
    drawCar(ctx, F1_CAR, 0.3, 0, 0, 0.15, color, { compound: 'soft', livery: skin.livery });
  }
  return canvas;
}

/**
 * The garage: daily reward and spin, car skins (bought with coins or won with medals) and your
 * medals. Signed out, it shows what there is to collect.
 */
export function showGarage(v: GarageView): void {
  const service = wallet();
  const signedIn = service !== null;
  let tab: Tab = 'daily';
  let w: Wallet | null = null;
  let walletError = '';
  let bests: Record<string, number> = {};
  let counts: MedalCounts = { author: 0, gold: 0, silver: 0, bronze: 0 };
  let loading = signedIn;
  let skinFilter: 'all' | 'owned' | 'shop' | 'medal' = 'all';
  let medalFilter: 'all' | Medal | 'none' = 'all';
  /** The skin whose Buy button was pressed once (press again to confirm). */
  let confirmBuy: string | null = null;
  let message: { text: string; ok: boolean } | null = null;

  const balance = el('div', { class: 'garage-balance' });
  const tabBar = el('div', { class: 'tabs' });
  const body = el('div', {});
  const note = el('p', { class: 'muted' });

  const setMessage = (text: string, ok: boolean) => {
    message = { text, ok };
    render();
  };

  const run = async (fn: () => Promise<void>) => {
    try {
      message = null;
      await fn();
    } catch (err) {
      message = { text: (err as Error).message, ok: false };
    }
    render();
  };

  const render = () => {
    balance.replaceChildren(signedIn && w ? coins(w.coins) : el('span'));
    tabBar.replaceChildren(
      ...TABS.map(([id, label]) => {
        const dot = id === 'daily' && w && (w.canClaim || w.canSpin) ? el('span', { class: 'badge-dot' }) : null;
        return el('button', { class: `tab${tab === id ? ' active' : ''}`, onclick: () => ((tab = id), (confirmBuy = null), render()) }, label, dot);
      }),
    );
    note.textContent = '';
    note.className = 'muted';
    if (message) {
      note.textContent = message.text;
      note.className = message.ok ? 'ok-note' : 'error';
    }
    if (tab === 'daily') body.replaceChildren(daily());
    else if (tab === 'skins') body.replaceChildren(skins());
    else body.replaceChildren(medals());
  };

  // ---------- Daily

  const daily = (): HTMLElement => {
    if (!signedIn) return signInPrompt('Sign in to collect a daily reward and spin the wheel every day.');
    if (loading) return el('p', { class: 'muted' }, 'Loading your wallet…');
    if (!w) return el('p', { class: 'error' }, walletError || "Couldn't load your wallet.");
    const wallet = w;
    // Days of this week already claimed, and which day a claim now would be.
    const claimed = wallet.canClaim ? wallet.streak % 7 : ((wallet.streak - 1) % 7) + 1;
    const week = el('div', { class: 'week' });
    DAILY_REWARDS.forEach((reward, i) => {
      const day = i + 1;
      const done = day <= claimed;
      const today = wallet.canClaim && day === claimed + 1;
      week.append(
        el(
          'div',
          { class: `day${done ? ' done' : ''}${today ? ' today' : ''}${day === 7 ? ' bonus' : ''}` },
          el('span', {}, day === 7 ? 'Day 7 bonus' : `Day ${day}`),
          coins(reward),
          el('small', {}, done ? '✓' : today ? 'Today' : ''),
        ),
      );
    });
    const claim = el(
      'button',
      {
        class: 'primary',
        disabled: !wallet.canClaim,
        onclick: () =>
          run(async () => {
            claim.disabled = true;
            const r = await service!.claimDaily();
            w = r.wallet;
            message = { text: `+${r.reward} coins! Streak: ${r.wallet.streak} day${r.wallet.streak === 1 ? '' : 's'}.`, ok: true };
          }),
      },
      wallet.canClaim ? `Claim ${wallet.nextReward} coins` : `Claimed · next in ${duration(wallet.resetsIn)}`,
    );
    const streak = wallet.streak > 0 ? `${wallet.streak}-day streak. ` : '';
    return el(
      'div',
      {},
      el('h2', {}, 'Daily reward'),
      el(
        'p',
        { class: 'muted' },
        `${streak}Log in every day: the reward climbs each day and day 7 is a big bonus. Miss a day and the week starts again.`,
        wallet.doubleDaily ? el('b', { style: 'color:#2ecc40' }, ' Your next reward is doubled!') : null,
      ),
      week,
      el('div', { class: 'buttons' }, claim),
      el('h2', {}, 'Daily spin'),
      wheel(wallet),
    );
  };

  /** The prize wheel; spinning asks the server for the prize, then turns the wheel to it. */
  const wheel = (wallet: Wallet): HTMLElement => {
    const size = 240;
    const canvas = el('canvas', { class: 'wheel' });
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    const ctx = canvas.getContext('2d')!;
    const seg = (Math.PI * 2) / SPIN_PRIZES.length;
    const draw = (angle: number) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);
      const c = size / 2;
      const r = c - 8;
      ctx.save();
      ctx.translate(c, c);
      ctx.rotate(angle);
      SPIN_PRIZES.forEach((p, i) => {
        // Segment i is centred straight up at angle 0.
        const a0 = -Math.PI / 2 + (i - 0.5) * seg;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, r, a0, a0 + seg);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = '#17181c';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.save();
        ctx.rotate(a0 + seg / 2);
        ctx.fillStyle = '#fff';
        ctx.font = '600 12px system-ui, sans-serif';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(p.label, r - 10, 0);
        ctx.restore();
      });
      ctx.restore();
      // Hub and pointer.
      ctx.fillStyle = '#17181c';
      ctx.beginPath();
      ctx.arc(c, c, 18, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffc83d';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(c, c, r + 2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#ffc83d';
      ctx.beginPath();
      ctx.moveTo(c - 10, 0);
      ctx.lineTo(c + 10, 0);
      ctx.lineTo(c, 22);
      ctx.closePath();
      ctx.fill();
    };
    draw(0);
    const left = wallet.extraSpins > 0 ? ` (${wallet.extraSpins} extra)` : '';
    const button = el(
      'button',
      {
        class: 'primary',
        disabled: !wallet.canSpin,
        onclick: async () => {
          button.disabled = true;
          message = null;
          note.textContent = '';
          let result;
          try {
            result = await service!.spin();
          } catch (err) {
            setMessage((err as Error).message, false);
            return;
          }
          const i = Math.max(0, SPIN_PRIZES.findIndex((p) => p.prize === result.prize));
          // Five turns, then stop with the prize under the pointer (somewhere inside its segment).
          const target = Math.PI * 10 - i * seg + (Math.random() - 0.5) * seg * 0.7;
          const start = performance.now();
          const spinFor = 4000;
          const frame = (now: number) => {
            const t = Math.min(1, (now - start) / spinFor);
            draw(target * (1 - Math.pow(1 - t, 3)));
            if (t < 1) {
              requestAnimationFrame(frame);
              return;
            }
            w = result.wallet;
            const skin = skinDef(result.skin ?? undefined);
            if (skin) skinFilter = 'owned';
            setMessage(`You won: ${prizeText(result.prize, skin?.name)}!`, true);
          };
          requestAnimationFrame(frame);
        },
      },
      wallet.canSpin ? `Spin${left}` : `Spun · next in ${duration(wallet.resetsIn)}`,
    );
    const odds = el('div', { class: 'keys muted' });
    for (const p of SPIN_PRIZES) odds.append(el('b', {}, `${p.weight}%`), el('span', {}, prizeText(p.prize)));
    return el(
      'div',
      { class: 'spin' },
      canvas,
      el(
        'div',
        {},
        el('p', { class: 'muted' }, 'One free spin a day: coins, a doubled daily reward, an extra spin, or a free skin you don’t own yet.'),
        el('div', { class: 'buttons' }, button),
        el('details', {}, el('summary', {}, 'Odds'), odds),
      ),
    );
  };

  // ---------- Skins

  const skins = (): HTMLElement => {
    const owned = w?.owned ?? [];
    const equipped = w?.equipped ?? TEAM_SKIN;
    const filters = el(
      'div',
      { class: 'chips' },
      ...(
        [
          ['all', 'All'],
          ['owned', 'Unlocked'],
          ['shop', 'Shop'],
          ['medal', 'Medal skins'],
        ] as const
      ).map(([id, label]) => el('button', { class: `chip${skinFilter === id ? ' active' : ''}`, onclick: () => ((skinFilter = id), render()) }, label)),
    );
    const grid = el('div', { class: 'skin-grid' });
    for (const skin of SKINS) {
      const unlocked = signedIn && skinUnlocked(skin, owned, counts);
      if (skinFilter === 'owned' && !unlocked) continue;
      if (skinFilter === 'shop' && skin.price === undefined) continue;
      if (skinFilter === 'medal' && !skin.unlock) continue;
      let action: HTMLElement;
      if (signedIn && equipped === skin.id) {
        action = el('button', { class: 'small equipped', disabled: true }, 'Equipped ✓');
      } else if (unlocked) {
        action = el('button', { class: 'small', disabled: !w, onclick: () => run(async () => void (w = await service!.equip(skin.id))) }, 'Equip');
      } else if (skin.unlock) {
        const have = counts[skin.unlock.medal];
        const need = skin.unlock.count;
        const what = `${need} ${MEDAL_NAMES[skin.unlock.medal].toLowerCase()} medal${need === 1 ? '' : 's'}${skin.unlock.medal === 'author' ? '' : ' or better'}`;
        action = el(
          'div',
          { class: 'unlock' },
          el('span', {}, signedIn ? `${Math.min(have, need)}/${need} · ${what}` : `Win ${what}`),
          el('div', { class: 'progress' }, el('i', { style: `width:${Math.min(100, (have / need) * 100)}%;background:${MEDAL_COLORS[skin.unlock.medal]}` })),
        );
      } else {
        const price = skin.price ?? 0;
        const confirming = confirmBuy === skin.id;
        action = el(
          'button',
          {
            class: `small${confirming ? ' primary' : ''}`,
            disabled: !w || w.coins < price,
            title: w && w.coins < price ? `You need ${price - w.coins} more coins` : '',
            onclick: () => {
              if (!confirming) {
                confirmBuy = skin.id;
                render();
                return;
              }
              confirmBuy = null;
              void run(async () => {
                w = await service!.buy(skin.id);
                message = { text: `${skin.name} is yours, and it's on your car.`, ok: true };
              });
            },
          },
          confirming ? 'Confirm' : 'Buy ',
          confirming ? null : coins(price),
        );
      }
      grid.append(
        el(
          'div',
          { class: `skin${signedIn && equipped === skin.id ? ' equipped' : ''}${unlocked ? '' : ' locked'}` },
          skinPreview(skin),
          el('b', {}, skin.name),
          el('span', { class: 'rarity', style: `color:${RARITY_COLORS[skin.rarity]}` }, skin.id === TEAM_SKIN ? 'Your lobby colour' : RARITY_NAMES[skin.rarity]),
          action,
        ),
      );
    }
    return el(
      'div',
      {},
      signedIn ? null : signInPrompt('Sign in to buy skins with coins and unlock medal skins.'),
      filters,
      grid.childElementCount ? grid : el('p', { class: 'muted' }, 'Nothing here yet.'),
      el('p', { class: 'muted' }, 'Your skin is shown to everyone in races. Your lobby colour stays on the minimap and your name tag.'),
    );
  };

  // ---------- Medals

  const medals = (): HTMLElement => {
    if (!signedIn) return signInPrompt('Sign in to earn time trial medals. They are kept with your account.');
    if (loading) return el('p', { class: 'muted' }, 'Loading your medals…');
    const best = new Map<string, Medal | null>(v.tracks.map((t) => [t.id, medalFor(bests[t.id], medalTimes(t.id) ?? { author: 0, gold: 0, silver: 0, bronze: 0 })]));
    const exact = (m: Medal) => [...best.values()].filter((x) => x === m).length;
    const tiles = el(
      'div',
      { class: 'medals' },
      ...MEDALS.map((m) =>
        el(
          'div',
          { class: `medal${exact(m) ? ' won' : ''}`, style: `--medal:${MEDAL_COLORS[m]}` },
          el('i', {}),
          el('span', {}, MEDAL_NAMES[m]),
          el('b', {}, String(exact(m))),
        ),
      ),
    );
    const pick = el('select', { onchange: () => ((medalFilter = pick.value as typeof medalFilter), render()) });
    for (const [id, label] of [['all', 'All tracks'], ...MEDALS.map((m) => [m, `${MEDAL_NAMES[m]} only`]), ['none', 'No medal yet']]) {
      pick.add(new Option(label, id, false, id === medalFilter));
    }
    const table = el('table', { class: 'results' });
    table.append(el('tr', {}, ...['Track', 'Your best', 'Medal', 'Next'].map((h) => el('th', {}, h))));
    for (const t of v.tracks) {
      const got = best.get(t.id) ?? null;
      if (medalFilter === 'none' ? got !== null : medalFilter !== 'all' && got !== medalFilter) continue;
      const times = medalTimes(t.id);
      const next = got === 'author' ? null : MEDALS[(got ? MEDALS.indexOf(got) : MEDALS.length) - 1];
      table.append(
        el(
          'tr',
          {},
          el('td', {}, t.name),
          el('td', {}, bests[t.id] !== undefined ? formatLapTime(bests[t.id]) : '-'),
          el('td', {}, got ? el('span', { class: 'medal-chip', style: `--medal:${MEDAL_COLORS[got]}` }, MEDAL_NAMES[got]) : ''),
          el('td', { class: 'muted' }, next && times ? `${MEDAL_NAMES[next]} ${formatLapTime(times[next])}` : got === 'author' ? '✓' : ''),
        ),
      );
    }
    return el(
      'div',
      {},
      tiles,
      el('p', { class: 'muted' }, `Medals unlock skins: ${SKINS.filter((s) => s.unlock).map((s) => `${s.name} (${s.unlock!.count} ${MEDAL_NAMES[s.unlock!.medal].toLowerCase()})`).join(', ')}.`),
      el('div', { style: 'margin:12px 0' }, pick),
      table,
    );
  };

  const signInPrompt = (text: string): HTMLElement => {
    const service = v.accounts;
    return el(
      'div',
      { class: 'warn', style: 'margin:12px 0' },
      text,
      service ? el('div', { class: 'buttons' }, el('button', { class: 'primary', onclick: () => showSignIn(service, () => showGarage(v)) }, 'Sign in')) : null,
    );
  };

  show(
    el(
      'div',
      { class: 'screen' },
      el(
        'div',
        { class: 'card wide' },
        el('div', { class: 'garage-head' }, el('h1', {}, 'Garage'), balance),
        el('p', { class: 'sub' }, 'Collect coins every day, buy skins, and win medal skins in time trial.'),
        tabBar,
        note,
        body,
        el('div', { class: 'buttons' }, el('button', { onclick: v.onBack }, 'Back')),
      ),
    ),
  );
  render();

  if (service) {
    const me = playerId();
    Promise.allSettled([service.get(), v.board.bestsOf(me, v.tracks.map((t) => t.id))]).then(([wr, br]) => {
      if (wr.status === 'fulfilled') w = wr.value;
      else walletError = (wr.reason as Error).message;
      if (br.status === 'fulfilled') {
        bests = br.value;
        counts = medalCounts(bests, v.tracks.map((t) => t.id));
      }
      loading = false;
      render();
    });
  }
}
