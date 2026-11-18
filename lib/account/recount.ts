// The re-count before each ONE_SITE_GUARD enforce step (one-account plan, Wave 0 / lane C1 item 7). READ-ONLY: it prints COUNTS only, never ids,
// emails or slugs, and writes nothing. Per environment ('Production' / 'Sandbox'; web 'live' / 'test' map to them):
//   mixedAccounts                accounts with both an Apple address and a published web address
//   appleTiedToWebAccount        Apple purchases tied to an account that has a web address or a live card plan
//   appleAddressAndLiveCardPlan  accounts with an Apple address and a live card plan (rule R1: an alert, never untied)
//   twoLiveApplePurchases        accounts with two or more live Apple purchases
//   webPlansWithoutAccount       live card plans whose account no longer exists
// "Live card plan" = active, trialing or past_due. "Live Apple purchase" = purchaseLive (not revoked, not taken down, not expired past grace).
import { purchaseLive } from '../ios/lapse.js';
import { isEntitledStatus } from '../webApp/stripeCore.js';
import { kindEnvOf, type KindEnv } from './kind.js';

export interface RecountFacts {
  now: number;
  apple: { original_transaction_id: string; user_id: string; environment: string | null; product_id: string | null; site_slug: string | null; expires_at: string | null; revoked_at: string | null; taken_down_at: string | null }[];
  webSites: { user_id: string; environment: 'live' | 'test'; published_at: string | null }[];
  cardPlans: { user_id: string; environment: 'live' | 'test'; status: string; stripe_subscription_id?: string | null }[];
  /** Does this account still exist? Called once per distinct card-plan account. */
  accountExists(uid: string): Promise<boolean>;
}
export interface RecountCounts {
  mixedAccounts: number; appleTiedToWebAccount: number; appleAddressAndLiveCardPlan: number; twoLiveApplePurchases: number; webPlansWithoutAccount: number;
}
export type Recount = Record<KindEnv, RecountCounts>;

const zero = (): RecountCounts => ({ mixedAccounts: 0, appleTiedToWebAccount: 0, appleAddressAndLiveCardPlan: 0, twoLiveApplePurchases: 0, webPlansWithoutAccount: 0 });

export async function recount(f: RecountFacts): Promise<Recount> {
  const out: Recount = { Production: zero(), Sandbox: zero() };
  const envs: KindEnv[] = ['Production', 'Sandbox'];
  const live = (s: string) => isEntitledStatus(s) && !s.startsWith('free');
  const exists = new Map<string, boolean>();
  for (const env of envs) {
    const apple = f.apple.filter((p) => p.environment === env && !!p.user_id);
    const web = new Set(f.webSites.filter((s) => kindEnvOf(s.environment) === env && !!s.published_at).map((s) => s.user_id));
    const cards = f.cardPlans.filter((c) => kindEnvOf(c.environment) === env && live(c.status));
    const card = new Set(cards.map((c) => c.user_id));
    const addr = new Set(apple.filter((p) => !!p.site_slug).map((p) => p.user_id));
    const c = out[env];
    for (const u of addr) {
      if (web.has(u)) c.mixedAccounts++;
      if (card.has(u)) c.appleAddressAndLiveCardPlan++;
    }
    c.appleTiedToWebAccount = apple.filter((p) => web.has(p.user_id) || card.has(p.user_id)).length;
    const liveByUser = new Map<string, number>();
    for (const p of apple) if (purchaseLive(p as never, f.now)) liveByUser.set(p.user_id, (liveByUser.get(p.user_id) ?? 0) + 1);
    c.twoLiveApplePurchases = [...liveByUser.values()].filter((n) => n >= 2).length;
    for (const cp of cards) {
      if (!exists.has(cp.user_id)) exists.set(cp.user_id, await f.accountExists(cp.user_id));
      if (!exists.get(cp.user_id)) c.webPlansWithoutAccount++;
    }
  }
  return out;
}

/** Live readers (service role, GET only). */
export async function liveRecountFacts(): Promise<RecountFacts> {
  const [{ sbRest }, { liveSignupNudgeDeps }] = await Promise.all([import('../webApp/webAppServer.js'), import('../webApp/signupNudges.js')]);
  const all = async (path: string, order: string): Promise<any[]> => {
    const rows: any[] = [];
    for (let offset = 0; ; offset += 1000) {
      const page = ((await sbRest(`${path}&order=${order}.asc&limit=1000&offset=${offset}`)) ?? []) as any[];
      rows.push(...page);
      if (page.length < 1000) return rows;
    }
  };
  const admin = liveSignupNudgeDeps('live');
  return {
    now: Date.now(),
    apple: await all('ios_purchases?user_id=not.is.null&select=original_transaction_id,user_id,environment,product_id,site_slug,expires_at,revoked_at,taken_down_at', 'original_transaction_id'),
    webSites: await all('web_app_sites?select=slug,user_id,environment,published_at', 'slug'),
    cardPlans: await all('web_app_entitlements?select=stripe_subscription_id,user_id,environment,status', 'stripe_subscription_id'),
    accountExists: async (uid) => (await admin.adminUser(uid)) !== null,
  };
}
