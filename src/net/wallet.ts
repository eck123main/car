import { isSkinId, TEAM_SKIN } from '../cosmetics/skins';
import { accounts, type AccountService } from './accounts';

/**
 * Coins and skins, kept with the account in the database (`supabase/economy.sql`), which does
 * all the sums. Signed-in players only, like medals.
 */
export interface Wallet {
  coins: number;
  /** Days in a row the daily reward was claimed (0 once a day was missed). */
  streak: number;
  canClaim: boolean;
  /** What claiming now gives (or tomorrow, once claimed). */
  nextReward: number;
  /** Won on the wheel: the next daily reward is doubled. */
  doubleDaily: boolean;
  canSpin: boolean;
  extraSpins: number;
  /** Seconds until the next UTC day (new reward and spin). */
  resetsIn: number;
  owned: string[];
  equipped: string;
}

/** Daily reward by day of the streak's week; day 7 is the weekly bonus. Same as `daily_reward` in SQL. */
export const DAILY_REWARDS = [50, 60, 70, 80, 100, 120, 300];

export type SpinPrize = 'c25' | 'c50' | 'c100' | 'c150' | 'c250' | 'c500' | 'double' | 'again' | 'skin';

/** The wheel, in drawing order, with the chance of each (out of 100). Same as `daily_spin` in SQL. */
export const SPIN_PRIZES: { prize: SpinPrize; label: string; weight: number; color: string }[] = [
  { prize: 'c25', label: '25', weight: 28, color: '#3a3d45' },
  { prize: 'c50', label: '50', weight: 25, color: '#2b5c8a' },
  { prize: 'c100', label: '100', weight: 18, color: '#3a3d45' },
  { prize: 'c150', label: '150', weight: 10, color: '#2b5c8a' },
  { prize: 'c250', label: '250', weight: 7, color: '#3a3d45' },
  { prize: 'c500', label: '500', weight: 2, color: '#b8860b' },
  { prize: 'double', label: '2× daily', weight: 5, color: '#1f7a4d' },
  { prize: 'again', label: 'Spin again', weight: 3, color: '#7a3db8' },
  { prize: 'skin', label: 'Free skin', weight: 2, color: '#c8102e' },
];

export function prizeText(prize: SpinPrize, skinName?: string): string {
  if (prize.startsWith('c')) return `${prize.slice(1)} coins`;
  if (prize === 'double') return 'Your next daily reward is doubled';
  if (prize === 'again') return 'Another spin';
  return skinName ? `Free skin: ${skinName}` : 'A free skin';
}

/** Per account, so switching accounts doesn't carry a skin over. */
const skinKey = (account: string) => `f1td.skin.${account}`;

/** The skin to race with: remembered here so a game can start without waiting for the server. */
export function equippedSkin(): string | undefined {
  const account = accounts()?.account();
  if (!account) return undefined;
  try {
    const id = localStorage.getItem(skinKey(account.id));
    return isSkinId(id) && id !== TEAM_SKIN ? id : undefined;
  } catch {
    return undefined;
  }
}

function remember(w: Wallet): Wallet {
  const account = accounts()?.account();
  try {
    if (account) localStorage.setItem(skinKey(account.id), w.equipped);
  } catch {
    // Picked up from the server next time.
  }
  return w;
}

export class WalletService {
  constructor(private readonly service: AccountService) {}

  private token(): string {
    const a = this.service.account();
    if (!a) throw new Error('Sign in to collect coins.');
    return a.token;
  }

  async get(): Promise<Wallet> {
    return remember(await this.service.rpc<Wallet>('get_wallet', { p_token: this.token() }));
  }

  async claimDaily(): Promise<{ wallet: Wallet; reward: number }> {
    const r = await this.service.rpc<{ wallet: Wallet; reward: number }>('claim_daily', { p_token: this.token() });
    remember(r.wallet);
    return r;
  }

  async spin(): Promise<{ wallet: Wallet; prize: SpinPrize; skin: string | null }> {
    const r = await this.service.rpc<{ wallet: Wallet; prize: SpinPrize; skin: string | null }>('daily_spin', { p_token: this.token() });
    remember(r.wallet);
    return r;
  }

  async buy(skin: string): Promise<Wallet> {
    return remember(await this.service.rpc<Wallet>('buy_skin', { p_token: this.token(), p_skin: skin }));
  }

  async equip(skin: string): Promise<Wallet> {
    return remember(await this.service.rpc<Wallet>('equip_skin', { p_token: this.token(), p_skin: skin }));
  }
}

/** The wallet for the signed-in account, or null when signed out (or no database). */
export function wallet(): WalletService | null {
  const service = accounts();
  return service?.account() ? new WalletService(service) : null;
}
