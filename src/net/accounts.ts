/**
 * Player accounts: a username and a password, no email. Kept in the same free Supabase
 * project as the leaderboard (`supabase/accounts.sql`); the database checks passwords and
 * hands out a session token, which this browser remembers. There is no password reset, so
 * players are told to save their password when they make an account.
 */

export interface Account {
  id: string;
  username: string;
  /** Session token: proves who we are when saving laps. */
  token: string;
}

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 16;
export const PASSWORD_MIN = 8;
/** bcrypt only reads this many bytes. */
export const PASSWORD_MAX = 72;

/** Why a username can't be used, or null if it's fine. Same rules as the database. */
export function usernameProblem(name: string): string | null {
  if (name.length < USERNAME_MIN || name.length > USERNAME_MAX) return `${USERNAME_MIN}-${USERNAME_MAX} characters`;
  if (!/^[A-Za-z0-9_.-]+$/.test(name)) return 'letters, numbers, _ . - only';
  return null;
}

/** Each password rule and whether it is met (shown as a checklist while typing). */
export function passwordRules(password: string): { text: string; ok: boolean }[] {
  return [
    { text: `At least ${PASSWORD_MIN} characters`, ok: password.length >= PASSWORD_MIN && password.length <= PASSWORD_MAX },
    { text: 'At least one letter', ok: /[A-Za-z]/.test(password) },
    { text: 'At least one number', ok: /[0-9]/.test(password) },
  ];
}

export function passwordOk(password: string): boolean {
  return passwordRules(password).every((r) => r.ok);
}

/** Error codes the database raises, in words. */
const ERRORS: Record<string, string> = {
  bad_username: `Usernames are ${USERNAME_MIN}-${USERNAME_MAX} letters, numbers, _ . or -.`,
  weak_password: `Passwords need ${PASSWORD_MIN}+ characters with a letter and a number.`,
  username_taken: 'That username is taken.',
  wrong_login: 'Wrong username or password.',
  wrong_password: 'Your current password is wrong.',
  locked: 'Too many wrong passwords. Try again in 5 minutes.',
  signed_out: 'You were signed out. Sign in again.',
};

export class AccountError extends Error {}

const KEY = 'f1td.account';

/** Talks to the account functions in the database (Supabase REST, `rpc/...`). */
export class AccountService {
  private current: Account | null = null;
  private readonly listeners = new Set<(a: Account | null) => void>();

  constructor(
    private readonly url: string,
    private readonly key: string,
  ) {
    try {
      const raw = localStorage.getItem(KEY);
      const a = raw ? (JSON.parse(raw) as Account) : null;
      if (a && typeof a.id === 'string' && typeof a.username === 'string' && typeof a.token === 'string') this.current = a;
    } catch {
      // Signed out then.
    }
  }

  account(): Account | null {
    return this.current;
  }

  onChange(fn: (a: Account | null) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private set(a: Account | null): void {
    this.current = a;
    try {
      if (a) localStorage.setItem(KEY, JSON.stringify(a));
      else localStorage.removeItem(KEY);
    } catch {
      // Only this visit then.
    }
    for (const l of this.listeners) l(a);
  }

  async rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.url}/rest/v1/rpc/${fn}`, {
        method: 'POST',
        headers: { apikey: this.key, 'Content-Type': 'application/json' },
        body: JSON.stringify(args),
      });
    } catch {
      throw new AccountError("Couldn't reach the server. Check your connection.");
    }
    if (res.ok) {
      const text = await res.text();
      return (text ? JSON.parse(text) : null) as T;
    }
    const body = (await res.json().catch(() => ({}))) as { message?: string; code?: string };
    if (res.status === 404 || body.code === 'PGRST202') throw new AccountError('Accounts are not set up on the server yet (run supabase/accounts.sql).');
    throw new AccountError(ERRORS[body.message ?? ''] ?? body.message ?? `Server error ${res.status}`);
  }

  async signUp(username: string, password: string): Promise<Account> {
    const a = await this.rpc<Account>('sign_up', { p_username: username, p_password: password });
    this.set(a);
    return a;
  }

  async signIn(username: string, password: string): Promise<Account> {
    const a = await this.rpc<Account>('sign_in', { p_username: username, p_password: password });
    this.set(a);
    return a;
  }

  async signOut(): Promise<void> {
    const a = this.current;
    this.set(null);
    if (a) await this.rpc('sign_out', { p_token: a.token }).catch(() => {});
  }

  async changePassword(oldPassword: string, newPassword: string): Promise<void> {
    const a = this.current;
    if (!a) throw new AccountError(ERRORS.signed_out);
    await this.rpc('change_password', { p_token: a.token, p_old: oldPassword, p_new: newPassword });
  }

  /** Check the remembered session is still good (signed out elsewhere, or the account is gone). */
  async verify(): Promise<void> {
    const a = this.current;
    if (!a) return;
    try {
      const who = await this.rpc<{ id: string; username: string } | null>('whoami', { p_token: a.token });
      if (this.current !== a) return;
      if (!who) this.set(null);
      else if (who.username !== a.username) this.set({ ...a, username: who.username });
    } catch {
      // Offline or server trouble: keep the session and try again next time.
    }
  }
}

let shared: AccountService | null | undefined;

/** The account service, or null when the build has no database (accounts need one). */
export function accounts(): AccountService | null {
  if (shared !== undefined) return shared;
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_KEY as string | undefined;
  shared = url && key ? new AccountService(url.replace(/\/$/, ''), key) : null;
  return shared;
}
