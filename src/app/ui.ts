import type { LobbyState, NetInfo } from '../net/protocol';
import { DIFFICULTIES, type Difficulty } from '../sim/ai/botDriver';
import { ALL_COMPOUNDS, COMPOUNDS, type Compound } from '../sim/tyres';
import { formatLapTime } from '../render/hud';
import { playerId, type Leaderboard } from '../net/leaderboard';
import { passwordOk, passwordRules, usernameProblem, type AccountService } from '../net/accounts';
import { pingColor, pingText } from '../render/ping';
import type { RaceSettings, Standing, Weather } from '../sim/session';
import type { RaceWorld } from '../sim/world';
import { settings, updateSettings, type Settings } from './settings';

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
  ['Mouse', 'Click the track to drive with the mouse: steer towards the cursor, left button throttle, right brake, middle DRS'],
  ['Space', 'DRS (in DRS zones; one press opens it)'],
  ['Shift (hold)', 'ERS boost'],
  ['P', 'Pit limiter'],
  ['1-5', 'Tyres for your next stop (S, M, H, Inter, Wet)'],
  ['C', 'Camera: fixed map or rotating (you always drive up)'],
  ['← / →', 'Spectating: switch driver (after your qualifying lap, once you finish, or joining late)'],
  ['R / Enter', 'Time trial: restart the lap from the start'],
  ['G', 'Time trial: switch ghost (top players, your best, off)'],
  ['Esc', 'Menu'],
];

function controlsHelp(): HTMLElement {
  const box = el('div', { class: 'keys muted' });
  for (const [k, v] of CONTROLS) box.append(el('b', {}, k), el('span', {}, v));
  return box;
}

/** Sound and HUD options; changes apply (and are remembered) straight away. */
function settingsPanel(): HTMLElement {
  const box = el('div', { class: 'settings' });
  const s = settings();
  const check = (label: string, key: keyof Omit<Settings, 'volume'>) => {
    const input = el('input', { type: 'checkbox', checked: s[key], onchange: () => updateSettings({ [key]: input.checked }) });
    box.append(el('span', {}, label), input);
  };
  check('Sound', 'sound');
  const volume = el('input', {
    type: 'range',
    min: '0',
    max: '100',
    value: String(Math.round(s.volume * 100)),
    oninput: () => updateSettings({ volume: Number(volume.value) / 100 }),
  });
  box.append(el('span', {}, 'Volume'), volume);
  check('Engine, wind and tyre sounds', 'engine');
  check('DRS, ERS and start light beeps', 'effects');
  check('Big live delta (top centre)', 'delta');
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
  onTimeTrial: (name: string) => void;
  /** Accounts, if this build has a database. */
  accounts: AccountService | null;
  /** Show this screen again (after signing in or out). */
  onBack: () => void;
}

/** First screen: enter a name (or sign in), then join (from an invite link), host, or practise. */
export function showWelcome(a: WelcomeActions): void {
  const account = a.accounts?.account() ?? null;
  const name = el('input', { type: 'text', class: 'big', placeholder: 'Your name', maxLength: 16, value: savedName() });
  const go = (fn: (n: string) => void) => () => {
    if (account) {
      fn(account.username);
      return;
    }
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
        el('button', { onclick: go(a.onTimeTrial) }, 'Time trial'),
        el('button', { onclick: go(a.onPractice) }, 'Practice solo'),
      ];
  name.addEventListener('keydown', (e) => e.key === 'Enter' && buttons[0].click());
  const service = a.accounts;
  let accountBar: HTMLElement | null = null;
  if (service && account) {
    accountBar = el(
      'div',
      { class: 'account-bar' },
      el('span', {}, 'Signed in as ', el('b', {}, account.username)),
      el('button', { class: 'small', onclick: () => showAccount(service, a.onBack) }, 'Account'),
    );
  } else if (service) {
    accountBar = el(
      'div',
      { class: 'account-bar' },
      el('span', { class: 'muted' }, 'Playing as a guest'),
      el('button', { class: 'small', onclick: () => showSignIn(service, a.onBack) }, 'Sign in'),
      el('button', { class: 'small', onclick: () => showSignUp(service, a.onBack) }, 'Create account'),
    );
  }
  show(
    el(
      'div',
      { class: 'screen' },
      el(
        'div',
        { class: 'card' },
        el('h1', { innerHTML: 'F1 <span>Top-Down</span>' }),
        el('p', { class: 'sub' }, a.joining ? "You've been invited to a race." : 'Race your friends. Share a link, no sign-up needed.'),
        accountBar,
        account ? null : name,
        el('div', { class: 'buttons' }, ...buttons),
        el('details', {}, el('summary', {}, 'Settings'), settingsPanel()),
        el('h2', {}, 'Controls'),
        controlsHelp(),
      ),
    ),
  );
  if (!account) name.focus();
}

/** A labelled input for the account forms. */
function field(label: string, input: HTMLInputElement): HTMLElement {
  return el('label', { class: 'field' }, el('span', {}, label), input);
}

/** Live checklist of the password rules. Returns whether they're all met. */
function rulesList(password: HTMLInputElement, confirm: HTMLInputElement): { box: HTMLElement; update: () => boolean } {
  const box = el('ul', { class: 'rules' });
  const update = () => {
    const rules = [...passwordRules(password.value), { text: 'Both passwords match', ok: password.value !== '' && password.value === confirm.value }];
    box.replaceChildren(...rules.map((r) => el('li', { class: r.ok ? 'ok' : '' }, `${r.ok ? '✓' : '•'} ${r.text}`)));
    return rules.every((r) => r.ok);
  };
  update();
  return { box, update };
}

/** An account form: runs `submit`, showing its error if it fails. */
function accountForm(button: HTMLButtonElement, error: HTMLElement, submit: () => Promise<void>, ...children: (Node | null)[]): HTMLFormElement {
  return el(
    'form',
    {
      onsubmit: async (e: Event) => {
        e.preventDefault();
        if (button.disabled) return;
        button.disabled = true;
        error.textContent = '';
        try {
          await submit();
        } catch (err) {
          error.textContent = (err as Error).message;
          button.disabled = false;
        }
      },
    },
    ...children,
  );
}

function card(title: string, sub: string, ...children: (Node | null)[]): HTMLElement {
  return el('div', { class: 'screen' }, el('div', { class: 'card' }, el('h1', {}, title), el('p', { class: 'sub' }, sub), ...children));
}

/** Sign in with a username and password. */
export function showSignIn(service: AccountService, onDone: () => void): void {
  const user = el('input', { type: 'text', autocomplete: 'username', maxLength: 16, required: true });
  const pass = el('input', { type: 'password', autocomplete: 'current-password', required: true });
  const error = el('p', { class: 'error' });
  const submit = el('button', { class: 'primary', type: 'submit' }, 'Sign in');
  const form = accountForm(
    submit,
    error,
    async () => {
      await service.signIn(user.value.trim(), pass.value);
      onDone();
    },
    field('Username', user),
    field('Password', pass),
    error,
    el('div', { class: 'buttons' }, submit, el('button', { type: 'button', onclick: onDone }, 'Back')),
  );
  show(
    card(
      'Sign in',
      'Your time trial laps are saved under your account, on any device.',
      form,
      el('p', { class: 'muted' }, "Forgot your password? Accounts have no email, so it can't be reset. You can make a new account."),
    ),
  );
  user.focus();
}

/** Make an account: username and password (with rules), then a reminder to save the password. */
export function showSignUp(service: AccountService, onDone: () => void): void {
  const user = el('input', { type: 'text', autocomplete: 'username', maxLength: 16, required: true, value: savedName() });
  const pass = el('input', { type: 'password', autocomplete: 'new-password', required: true });
  const confirm = el('input', { type: 'password', autocomplete: 'new-password', required: true });
  const userNote = el('p', { class: 'muted' });
  const error = el('p', { class: 'error' });
  const submit = el('button', { class: 'primary', type: 'submit' }, 'Create account');
  const rules = rulesList(pass, confirm);
  const check = () => {
    const problem = usernameProblem(user.value.trim());
    userNote.textContent = problem && user.value ? `Username: ${problem}` : '';
    submit.disabled = !rules.update() || problem !== null;
  };
  for (const i of [user, pass, confirm]) i.addEventListener('input', check);
  check();
  const form = accountForm(
    submit,
    error,
    async () => {
      const acc = await service.signUp(user.value.trim(), pass.value);
      showSavePassword(acc.username, pass.value, onDone);
    },
    field('Username', user),
    userNote,
    field('Password', pass),
    field('Confirm password', confirm),
    rules.box,
    error,
    el('div', { class: 'buttons' }, submit, el('button', { type: 'button', onclick: onDone }, 'Back')),
  );
  show(card('Create account', 'Just a username and a password, no email. Your username is your name on the leaderboard.', form));
  user.focus();
}

/**
 * Shown right after a password is set: it can't be reset, so the player has to confirm they
 * saved it before going on.
 */
function showSavePassword(username: string, password: string, onDone: () => void): void {
  const shown = el('input', { type: 'password', readOnly: true, value: password });
  const reveal = el(
    'button',
    {
      type: 'button',
      onclick: () => {
        shown.type = shown.type === 'password' ? 'text' : 'password';
        reveal.textContent = shown.type === 'password' ? 'Show' : 'Hide';
      },
    },
    'Show',
  );
  const copy = el(
    'button',
    {
      type: 'button',
      onclick: async () => {
        try {
          await navigator.clipboard.writeText(password);
          copy.textContent = 'Copied';
        } catch {
          shown.type = 'text';
          shown.select();
        }
      },
    },
    'Copy',
  );
  const cont = el('button', { class: 'primary', disabled: true, onclick: onDone }, 'Continue');
  const saved = el('input', { type: 'checkbox', onchange: () => (cont.disabled = !saved.checked) });
  show(
    card(
      'Save your password now',
      `Account: ${username}`,
      el(
        'div',
        { class: 'warn' },
        el('b', {}, 'Important: '),
        'accounts have no email, so a forgotten password can NOT be reset or recovered. ' +
          'Write it down or save it in your password manager before you go on.',
      ),
      el('div', { class: 'invite', style: 'margin-top:14px' }, shown, reveal, copy),
      el('label', { class: 'confirm' }, saved, 'I have saved my password somewhere safe'),
      el('div', { class: 'buttons' }, cont),
    ),
  );
}

/** Signed in: change the password or sign out. */
export function showAccount(service: AccountService, onDone: () => void): void {
  const acc = service.account();
  if (!acc) {
    onDone();
    return;
  }
  // Hidden, so a password manager knows which account the new password is for.
  const user = el('input', { type: 'text', autocomplete: 'username', value: acc.username, readOnly: true, style: 'display:none' });
  const old = el('input', { type: 'password', autocomplete: 'current-password', required: true });
  const pass = el('input', { type: 'password', autocomplete: 'new-password', required: true });
  const confirm = el('input', { type: 'password', autocomplete: 'new-password', required: true });
  const error = el('p', { class: 'error' });
  const submit = el('button', { class: 'primary', type: 'submit' }, 'Change password');
  const rules = rulesList(pass, confirm);
  const check = () => (submit.disabled = !rules.update() || old.value === '');
  for (const i of [old, pass, confirm]) i.addEventListener('input', check);
  check();
  const form = accountForm(
    submit,
    error,
    async () => {
      if (!passwordOk(pass.value)) return;
      await service.changePassword(old.value, pass.value);
      showSavePassword(acc.username, pass.value, onDone);
    },
    user,
    field('Current password', old),
    field('New password', pass),
    field('Confirm new password', confirm),
    rules.box,
    error,
    el('div', { class: 'buttons' }, submit),
  );
  const signOut = async () => {
    await service.signOut();
    onDone();
  };
  show(
    card(
      acc.username,
      'Time trial laps you set while signed in are saved under this name.',
      el('h2', {}, 'Change password'),
      form,
      el('div', { class: 'buttons' }, el('button', { onclick: signOut }, 'Sign out'), el('button', { onclick: onDone }, 'Back')),
    ),
  );
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

/**
 * Show each player's ping in the lobby, in place (no re-render, so an open menu stays open).
 * "relayed" means WebRTC couldn't link the two browsers directly and goes through a relay
 * server, often far away: the usual reason for a high ping between players who live close.
 */
export function updateLobbyNet(net: readonly NetInfo[]): void {
  let relayed = false;
  for (const span of root.querySelectorAll<HTMLElement>('.players .ping')) {
    const info = net.find((n) => n.id === span.dataset.net);
    span.textContent = pingText(info, true) ?? '';
    span.style.color = info?.relayed ? '#ff8a00' : info && info.ping !== null ? pingColor(info.ping) : '';
    if (info?.relayed) relayed = true;
  }
  const note = root.querySelector('.net-note');
  if (note) {
    note.textContent = relayed
      ? 'Relayed = no direct link between your browsers, so traffic goes via a relay server and ping is higher. Usually a strict router or network on one side.'
      : '';
  }
}

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
    if (!p.host && !p.bot) {
      // Filled in (and kept up to date) by updateLobbyNet.
      const ping = el('span', { class: 'ping' });
      ping.dataset.net = p.id;
      li.append(ping);
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
    const sc = el('input', { type: 'checkbox', checked: s.safetyCar, onchange: () => v.onSettings({ safetyCar: sc.checked }) });
    const gap = el('select', { onchange: () => v.onSettings({ releaseGap: Number(gap.value) }) });
    for (const g of [10, 15]) gap.add(new Option(`${g} s`, String(g), false, g === s.releaseGap));
    row('Track', track);
    row('Laps', laps);
    row('Weather', weather);
    row('Qualifying (1 timed lap)', quali);
    row('Qualifying gap between cars', gap);
    row('Mandatory pit stop (dry)', stop);
    row('Safety car (after big crashes)', sc);
  } else {
    row('Track', trackName);
    row('Laps', String(s.laps));
    row('Weather', WEATHER[s.weather]);
    row('Qualifying', s.qualifying ? `Yes, ${s.releaseGap} s apart` : 'No (grid in join order)');
    row('Mandatory pit stop', s.mandatoryStop ? 'Yes' : 'No');
    row('Safety car', s.safetyCar ? 'Yes' : 'No');
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
        el('p', { class: 'sub net-note' }),
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
  /** Host: race again with everyone, same settings. */
  onPlayAgain?: () => void;
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
    else if (s.lapsDown > 0) time = `+${s.lapsDown} lap${s.lapsDown > 1 ? 's' : ''}`;
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
          v.isHost && v.onPlayAgain ? el('button', { class: 'primary', onclick: v.onPlayAgain }, 'Play again') : null,
          v.isHost && v.onContinue ? el('button', { onclick: v.onContinue }, 'Back to lobby') : null,
          !v.isHost ? el('span', { class: 'muted' }, 'Waiting for the host…') : null,
          el('button', { onclick: v.onLeave }, 'Leave'),
        ),
      ),
    ),
  );
}

/** Esc menu during a session. */
export function showPauseMenu(
  onResume: () => void,
  onLeave: () => void,
  note: string,
  leaveLabel = 'Leave',
  extra?: { label: string; onClick: () => void },
): void {
  show(
    el(
      'div',
      { class: 'screen overlay' },
      el(
        'div',
        { class: 'card' },
        el('h1', {}, 'Menu'),
        el('p', { class: 'sub' }, note),
        el(
          'div',
          { class: 'buttons' },
          el('button', { class: 'primary', onclick: onResume }, 'Resume'),
          extra ? el('button', { onclick: extra.onClick }, extra.label) : null,
          el('button', { onclick: onLeave }, leaveLabel),
        ),
        el('h2', {}, 'Settings'),
        settingsPanel(),
        el('h2', {}, 'Controls'),
        controlsHelp(),
      ),
    ),
  );
}

export interface TyrePickerState {
  selected: Compound;
  ready: boolean;
  /** Seconds until the lights start at the latest. */
  endsIn: number;
  recommended: Compound;
  /** Extra advice, e.g. the two-compound rule. */
  note: string;
  /** Names of drivers not ready yet. */
  waitingFor: string[];
}

/**
 * Starting tyre choice on the grid. Updates itself from `state()` until closed.
 * Returns a function that removes it.
 */
export function showTyrePicker(state: () => TyrePickerState, onPick: (c: Compound) => void, onReady: () => void): () => void {
  const cards = new Map<Compound, HTMLElement>();
  const grid = el('div', { class: 'tyres' });
  for (const c of ALL_COMPOUNDS) {
    const info = COMPOUNDS[c];
    const bars = (label: string, value: number) =>
      el('div', { class: 'tyre-bar' }, el('span', {}, label), el('i', { style: `width:${Math.round(value * 100)}%` }));
    const card = el(
      'button',
      { class: 'tyre', onclick: () => onPick(c), title: `${info.name} (key ${ALL_COMPOUNDS.indexOf(c) + 1})` },
      el('div', { class: 'badge', style: `border-color:${info.color};color:${info.color}` }, info.letter),
      el('b', {}, info.name),
      bars('Dry', info.dryGrip / 1.05),
      bars('Wet', info.wetGrip / 1.05),
      el('div', { class: 'muted' }, `Lasts ~${Math.round(info.lifeLaps * 0.75)} laps`),
      el('div', { class: 'rec' }, 'Recommended'),
    );
    cards.set(c, card);
    grid.append(card);
  }
  const countdown = el('div', { class: 'muted' });
  const note = el('div', { class: 'muted' });
  const ready = el('button', { class: 'primary', onclick: onReady }, 'Ready (Enter)');
  show(
    el(
      'div',
      { class: 'screen overlay picker' },
      el('div', { class: 'card wide' }, el('h1', {}, 'Choose your starting tyres'), note, grid, el('div', { class: 'buttons' }, ready, countdown)),
    ),
  );
  const update = () => {
    const s = state();
    for (const [c, card] of cards) {
      card.classList.toggle('selected', c === s.selected);
      card.classList.toggle('recommended', c === s.recommended);
    }
    note.textContent = s.note;
    ready.disabled = s.ready;
    ready.textContent = s.ready ? 'Ready ✓' : 'Ready (Enter)';
    const waiting = s.waitingFor.length ? ` · waiting for ${s.waitingFor.join(', ')}` : '';
    countdown.textContent = `Lights in ${Math.max(0, Math.ceil(s.endsIn))} s at the latest${waiting}`;
  };
  update();
  const timer = setInterval(update, 100);
  return () => {
    clearInterval(timer);
    if (root.querySelector('.picker')) clearUi();
  };
}

export interface TimeTrialMenu {
  tracks: { id: string; name: string }[];
  track: string;
  board: Leaderboard;
  /** Track id, and whose ghost to race (see GhostChoice). */
  onDrive: (track: string, ghost: string) => void;
  onBack: () => void;
}

/** Time trial: pick a track, see its leaderboard, drive. */
export function showTimeTrialMenu(m: TimeTrialMenu): void {
  const select = el('select', { style: 'width:100%' });
  for (const t of m.tracks) select.append(el('option', { value: t.id, selected: t.id === m.track }, t.name));
  const table = el('table', { class: 'results' });
  const status = el('p', { class: 'muted' });
  const ghost = el('select', { style: 'width:100%' });
  const me = playerId();
  let shownFor = '';
  const load = async () => {
    const track = select.value;
    shownFor = track;
    table.replaceChildren();
    status.textContent = 'Loading times…';
    const ghostOption = (value: string, text: string) => el('option', { value }, text);
    ghost.replaceChildren(ghostOption('auto', 'Record lap (yours once you hold the record)'), ghostOption('personal', 'Your best lap'), ghostOption('off', 'No ghost'));
    try {
      const rows = await m.board.top(track, 10);
      if (shownFor !== track) return;
      rows.forEach((r, i) => {
        if (r.player !== me) ghost.append(ghostOption(r.player, `P${i + 1} ${r.name} · ${formatLapTime(r.time)}`));
      });
      status.textContent = rows.length === 0 ? 'No times yet: set the first one!' : '';
      if (rows.length > 0) table.append(el('tr', {}, ...['Pos', 'Driver', 'Time', 'Gap'].map((h) => el('th', {}, h))));
      rows.forEach((r, i) =>
        table.append(
          el(
            'tr',
            { class: r.player === me ? 'me' : '' },
            el('td', {}, String(i + 1)),
            el('td', {}, r.name),
            el('td', {}, formatLapTime(r.time)),
            el('td', {}, i === 0 ? '' : `+${(r.time - rows[0].time).toFixed(3)}`),
          ),
        ),
      );
    } catch {
      if (shownFor === track) status.textContent = "Couldn't reach the leaderboard.";
    }
  };
  select.addEventListener('change', () => void load());
  show(
    el(
      'div',
      { class: 'screen' },
      el(
        'div',
        { class: 'card wide' },
        el('h1', {}, 'Time Trial'),
        el(
          'p',
          { class: 'sub' },
          'Alone on track, soft tyres, DRS in every zone and ERS. All four wheels off the track and the lap is cancelled. ' +
            "Beat the times below and race the record holder's ghost.",
        ),
        select,
        el('h2', {}, 'Ghost to race'),
        ghost,
        el('p', { class: 'muted' }, 'Press G while driving to switch ghost.'),
        el('h2', {}, m.board.global ? 'World leaderboard' : 'Leaderboard (this device only)'),
        status,
        table,
        el(
          'div',
          { class: 'buttons' },
          el('button', { class: 'primary', onclick: () => m.onDrive(select.value, ghost.value) }, 'Drive'),
          el('button', { onclick: m.onBack }, 'Back'),
        ),
      ),
    ),
  );
  void load();
}
