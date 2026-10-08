import type { LobbyState } from '../net/protocol';
import { DIFFICULTIES, type Difficulty } from '../sim/ai/botDriver';
import { formatLapTime } from '../render/hud';
import type { RaceSettings, Standing, Weather } from '../sim/session';
import type { RaceWorld } from '../sim/world';

const root = document.getElementById('ui') as HTMLDivElement;

type ElProps<K extends keyof HTMLElementTagNameMap> = Omit<Partial<HTMLElementTagNameMap[K]>, 'style'> & {
  class?: string;
  style?: string;
};

/** Tiny element builder. */
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: ElProps<K> = {} as ElProps<K>,
  ...children: (Node | string | null)[]
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  const { class: cls, style, ...rest } = props;
  if (cls) e.className = cls;
  if (style) e.style.cssText = style;
  Object.assign(e, rest);
  for (const c of children) if (c !== null) e.append(c);
  return e;
}

function show(screen: HTMLElement): void {
  root.replaceChildren(screen);
}

export function clearUi(): void {
  root.replaceChildren();
}

const CONTROLS: [string, string][] = [
  ['WASD / Arrows', 'Drive'],
  ['Space (hold)', 'DRS (in DRS zones)'],
  ['Shift (hold)', 'ERS boost'],
  ['P', 'Pit limiter'],
  ['1-5', 'Tyres for your next stop (S, M, H, Inter, Wet)'],
  ['Esc', 'Menu'],
];

function controlsHelp(): HTMLElement {
  const box = el('div', { class: 'keys muted' });
  for (const [k, v] of CONTROLS) box.append(el('b', {}, k), el('span', {}, v));
  return box;
}

const NAME_KEY = 'f1td.name';

function savedName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

function saveName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    // Remembering the name is a convenience only.
  }
}

export interface WelcomeActions {
  joining: boolean;
  onJoin: (name: string) => void;
  onHost: (name: string) => void;
  onBots: (name: string) => void;
  onPractice: (name: string) => void;
}

/** First screen: enter a name, then join (from an invite link), host, or practise. */
export function showWelcome(a: WelcomeActions): void {
  const name = el('input', { type: 'text', class: 'big', placeholder: 'Your name', maxLength: 16, value: savedName() });
  const go = (fn: (n: string) => void) => () => {
    const n = name.value.trim();
    if (!n) {
      name.focus();
      return;
    }
    saveName(n);
    fn(n);
  };
  const buttons = a.joining
    ? [el('button', { class: 'primary', onclick: go(a.onJoin) }, 'Join lobby')]
    : [
        el('button', { class: 'primary', onclick: go(a.onHost) }, 'Create lobby'),
        el('button', { onclick: go(a.onBots) }, 'Race against bots'),
        el('button', { onclick: go(a.onPractice) }, 'Practice solo'),
      ];
  name.addEventListener('keydown', (e) => e.key === 'Enter' && buttons[0].click());
  show(
    el(
      'div',
      { class: 'screen' },
      el(
        'div',
        { class: 'card' },
        el('h1', { innerHTML: 'F1 <span>Top-Down</span>' }),
        el('p', { class: 'sub' }, a.joining ? "You've been invited to a race." : 'Race your friends. Share a link, no sign-up.'),
        name,
        el('div', { class: 'buttons' }, ...buttons),
        el('h2', {}, 'Controls'),
        controlsHelp(),
      ),
    ),
  );
  name.focus();
}

export function showMessage(title: string, text: string, button?: { label: string; onClick: () => void }): void {
  show(
    el(
      'div',
      { class: 'screen' },
      el(
        'div',
        { class: 'card' },
        el('h1', {}, title),
        el('p', { class: 'sub' }, text),
        button ? el('div', { class: 'buttons' }, el('button', { class: 'primary', onclick: button.onClick }, button.label)) : null,
      ),
    ),
  );
}

export interface LobbyView {
  lobby: LobbyState;
  meId: string;
  isHost: boolean;
  inviteLink: string;
  tracks: { id: string; name: string }[];
  onSettings: (changes: Partial<RaceSettings>) => void;
  onStart: () => void;
  onLeave: () => void;
  /** Host only. */
  onAddBot?: (difficulty: Difficulty) => void;
  onRemoveBot?: (id: string) => void;
}

const DIFFICULTY_NAMES: Record<Difficulty, string> = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };

const WEATHER: Record<Weather, string> = {
  dry: 'Dry',
  wet: 'Wet',
  rain: 'Rain later',
  drying: 'Wet, drying out',
};

/** The lobby: players, invite link, and race settings (editable by the host only). */
export function showLobby(v: LobbyView): void {
  const s = v.lobby.settings;
  const players = el('ul', { class: 'players' });
  for (const p of v.lobby.players) {
    const li = el('li', {}, el('span', { class: 'dot', style: `background:${p.color}` }), el('span', {}, p.name));
    if (p.host) li.append(el('span', { class: 'tag' }, 'HOST'));
    if (p.id === v.meId) li.append(el('span', { class: 'tag you' }, 'YOU'));
    if (p.bot) {
      li.append(el('span', { class: 'tag bot' }, `BOT · ${DIFFICULTY_NAMES[p.bot]}`));
      if (v.isHost && v.onRemoveBot) {
        const remove = v.onRemoveBot;
        li.append(el('button', { class: 'small', title: 'Remove bot', onclick: () => remove(p.id) }, '✕'));
      }
    }
    players.append(li);
  }
  let botControls: HTMLElement | null = null;
  if (v.isHost && v.onAddBot) {
    const add = v.onAddBot;
    const pick = el('select', {});
    for (const d of DIFFICULTIES) pick.add(new Option(DIFFICULTY_NAMES[d], d, false, d === 'medium'));
    const full = v.lobby.players.length >= 10;
    botControls = el(
      'div',
      { class: 'buttons' },
      pick,
      el('button', { disabled: full, onclick: () => add(pick.value as Difficulty) }, full ? 'Lobby full' : 'Add bot'),
    );
  }

  const link = el('input', { type: 'text', readOnly: true, value: v.inviteLink });
  const copy = el('button', {
    onclick: async () => {
      try {
        await navigator.clipboard.writeText(v.inviteLink);
        copy.textContent = 'Copied';
      } catch {
        link.select();
      }
    },
  }, 'Copy');

  const settings = el('div', { class: 'settings' });
  const row = (label: string, control: HTMLElement | string) =>
    settings.append(el('span', {}, label), typeof control === 'string' ? el('span', { class: 'value' }, control) : control);
  const trackName = v.tracks.find((t) => t.id === s.trackId)?.name ?? s.trackId;

  if (v.isHost) {
    const track = el('select', { onchange: () => v.onSettings({ trackId: track.value }) });
    for (const t of v.tracks) track.add(new Option(t.name, t.id, false, t.id === s.trackId));
    const laps = el('input', {
      type: 'number',
      min: '1',
      max: '50',
      value: String(s.laps),
      style: 'width:80px',
      onchange: () => v.onSettings({ laps: Math.max(1, Math.min(50, Math.round(Number(laps.value)) || 1)) }),
    });
    const weather = el('select', { onchange: () => v.onSettings({ weather: weather.value as Weather }) });
    for (const [id, label] of Object.entries(WEATHER)) weather.add(new Option(label, id, false, id === s.weather));
    const quali = el('input', { type: 'checkbox', checked: s.qualifying, onchange: () => v.onSettings({ qualifying: quali.checked }) });
    const stop = el('input', { type: 'checkbox', checked: s.mandatoryStop, onchange: () => v.onSettings({ mandatoryStop: stop.checked }) });
    const gap = el('select', { onchange: () => v.onSettings({ releaseGap: Number(gap.value) }) });
    for (const g of [10, 15]) gap.add(new Option(`${g} s`, String(g), false, g === s.releaseGap));
    row('Track', track);
    row('Laps', laps);
    row('Weather', weather);
    row('Qualifying (1 timed lap)', quali);
    row('Qualifying gap between cars', gap);
    row('Mandatory pit stop (dry)', stop);
  } else {
    row('Track', trackName);
    row('Laps', String(s.laps));
    row('Weather', WEATHER[s.weather]);
    row('Qualifying', s.qualifying ? `Yes, ${s.releaseGap} s apart` : 'No (grid in join order)');
    row('Mandatory pit stop', s.mandatoryStop ? 'Yes' : 'No');
  }

  const start = el('button', { class: 'primary', onclick: v.onStart }, 'Start');
  show(
    el(
      'div',
      { class: 'screen' },
      el(
        'div',
        { class: 'card' },
        el('h1', {}, 'Lobby'),
        el(
          'p',
          { class: 'sub' },
          !v.isHost ? 'Waiting for the host to start…' : v.inviteLink ? 'Send your friends the link, add bots if you like, then start.' : 'Add some bots, pick the race settings, then start.',
        ),
        el('h2', {}, `Drivers (${v.lobby.players.length}/10)`),
        players,
        botControls,
        v.inviteLink ? el('h2', {}, 'Invite link') : null,
        v.inviteLink ? el('div', { class: 'invite' }, link, copy) : null,
        el('h2', {}, 'Race'),
        settings,
        el('div', { class: 'buttons' }, v.isHost ? start : null, el('button', { onclick: v.onLeave }, 'Leave')),
      ),
    ),
  );
}

export interface ResultsView {
  standings: Standing[];
  world: RaceWorld;
  meId: string;
  isHost: boolean;
  /** Host: back to lobby. Others wait for the host. */
  onContinue?: () => void;
  onLeave: () => void;
}

export function showResults(v: ResultsView): void {
  const table = el('table', { class: 'results' });
  table.append(
    el('tr', {}, ...['Pos', 'Driver', 'Time', 'Best lap', 'Pen.'].map((h) => el('th', {}, h))),
  );
  const leader = v.standings[0];
  for (const s of v.standings) {
    const r = v.world.racer(s.id);
    if (!r) continue;
    let time = '';
    if (s.status === 'dnf') time = 'DNF';
    else if (s.totalTime !== null && s === leader) time = formatLapTime(s.totalTime);
    else if (s.totalTime !== null && leader.totalTime !== null) time = `+${(s.totalTime - leader.totalTime).toFixed(3)}`;
    else time = `${s.laps} laps`;
    const tr = el(
      'tr',
      { class: s.id === v.meId ? 'me' : '' },
      el('td', {}, String(s.position)),
      el('td', {}, el('span', { class: 'dot', style: `display:inline-block;vertical-align:-2px;margin-right:8px;background:${r.color}` }), r.name),
      el('td', {}, time),
      el('td', {}, s.bestLap !== null ? formatLapTime(s.bestLap) : '-'),
      el('td', {}, s.penalties ? `+${s.penalties}s` : ''),
    );
    table.append(tr);
  }
  const penalties = v.world.racers.flatMap((r) => r.penalties.map((p) => `${r.name}: +${p.seconds}s ${p.reason}`));
  show(
    el(
      'div',
      { class: 'screen overlay' },
      el(
        'div',
        { class: 'card wide' },
        el('h1', {}, 'Race results'),
        table,
        penalties.length ? el('h2', {}, 'Penalties') : null,
        penalties.length ? el('div', { class: 'muted' }, ...penalties.flatMap((p) => [p, el('br')])) : null,
        el(
          'div',
          { class: 'buttons' },
          v.isHost && v.onContinue ? el('button', { class: 'primary', onclick: v.onContinue }, 'Back to lobby') : null,
          !v.isHost ? el('span', { class: 'muted' }, 'Waiting for the host…') : null,
          el('button', { onclick: v.onLeave }, 'Leave'),
        ),
      ),
    ),
  );
}

/** Esc menu during a session. */
export function showPauseMenu(onResume: () => void, onLeave: () => void, note: string): void {
  show(
    el(
      'div',
      { class: 'screen overlay' },
      el(
        'div',
        { class: 'card' },
        el('h1', {}, 'Menu'),
        el('p', { class: 'sub' }, note),
        el('div', { class: 'buttons' }, el('button', { class: 'primary', onclick: onResume }, 'Resume'), el('button', { onclick: onLeave }, 'Leave')),
        el('h2', {}, 'Controls'),
        controlsHelp(),
      ),
    ),
  );
}
