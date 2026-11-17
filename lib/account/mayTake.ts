// "May this account take this purchase?" (one-account plan, lane C1, items 4). Every place that ties an Apple purchase to an account or a
// shop asks first. NO when:
//   - the account's kind is 'web' (it holds a web address, or pays a card plan and holds no Apple address): reason 'web-account'
//   - the account's kind is 'mixed' (a web and an Apple address): reason 'mixed' (one alert to the owner, never emailed)
//   - the account already holds an Apple address on a DIFFERENT purchase (a different Apple ID): reason 'other-apple-id'. "Holds" is the
//     address row when the table has one (holder 'apple', its slug on another original_transaction_id; holder 'web' is the first case);
//     with no row (not backfilled yet) the account's own Apple purchases with a slug decide, so the answer does not wait for the backfill.
// YES (decision, flagged in the report): a purchase that is ALREADY linked to this account. Nothing new is taken, and refusing would
// change today's behaviour for a mixed account ("today's behaviour on both sides"). A republish by a linked purchase never reaches this.
// Kind uses the DECISION reading of lib/account/kind.ts (Apple rows filtered by environment like appStoreGuard.counts()).
//
// Two layers:
//   mayTakePurchase(uid, otid)    pure-ish decision over injected readers. Throws on a read error.
//   checkTie(uid, otid, where)    what a tie point calls. Applies ONE_SITE_GUARD: OFF = 'allow' with no read at all; 'alert' = record and
//                                 alert, then 'allow' (never refuses); '1' = record, alert, email, 'refuse'. A read error: alert = 'allow'
//                                 (as today), '1' = 'unavailable' (the caller answers 503 / skips the tie BEFORE writing anything).
// Flows receive it as an optional dep (`tie`); absent = today's behaviour. liveTie() is the live wiring.
import { sbRest } from '../webApp/webAppServer.js';
import { readStoredGroup } from '../webApp/priceGroup.js';
import { loadKindFacts, liveKindDeps, readKind, countedApplePurchases, type AccountKind, type KindDeps, type KindEnv } from './kind.js';
import { defaultKindEnv } from './plan.js';
import { guardMode, tableMissing, type AddressRow, type GuardMode } from './sites.js';
import { reportBlocked, type BlockReason, type BlockedInfo } from './blocked.js';

export type MayTake =
  | { may: true }
  | { may: false; reason: BlockReason; kind: AccountKind; /** The address the account already holds (null = none). */ slug: string | null; /** The purchase's environment, when it is known. */ environment: 'Production' | 'Sandbox' | null; /** web-account and mixed only: does the account still have a live plan (a card plan or Free)? false = its web plan has ended. */ planLive?: boolean };

export interface MayTakeDeps {
  kindDeps: KindDeps;
  /** Only a fallback for a purchase with no row: the purchase's own environment decides (B6), so a missing Stripe key never matters for a known purchase. */
  env(): KindEnv;
  /** The account's address row; null when none or when the table is missing. */
  address(uid: string, env: KindEnv): Promise<AddressRow | null>;
  /** The purchase by original transaction id. */
  purchase(otid: string): Promise<{ original_transaction_id: string; user_id: string | null; environment: string | null } | null>;
  /** Is the account on the Free group (a plan with no card)? A failed read counts as live (never claim a plan ended on a guess). */
  isFree?(uid: string): Promise<boolean>;
  /** The purchase holding a slug. */
  purchaseOfSlug(slug: string): Promise<{ original_transaction_id: string; user_id: string | null } | null>;
}

export async function mayTakePurchase(uid: string, otid: string, deps: MayTakeDeps = liveMayTakeDeps()): Promise<MayTake> {
  const purchase = await deps.purchase(otid);
  if (purchase?.user_id === uid) return { may: true };
  const environment = purchase?.environment === 'Production' || purchase?.environment === 'Sandbox' ? purchase.environment : null;
  // The SAME environment tryTake uses for this purchase (tx.environment): a Sandbox purchase is judged against Sandbox rows, a Production one against
  // Production rows. Web tables map Production -> live, Sandbox -> test inside loadKindFacts. No dependence on the deployment's Stripe key.
  const env: KindEnv = environment ?? deps.env();
  const facts = await loadKindFacts(uid, env, deps.kindDeps);
  const reading = readKind(facts);
  const row = await deps.address(uid, env);
  const webSlug = facts.webSites.find((s) => !!s.published_at)?.slug ?? (row?.holder === 'web' && row.published_once ? row.slug : null);
  const own = countedApplePurchases(facts.applePurchases, env).filter((p) => !!p.site_slug);
  const appleSlug = own[0]?.site_slug ?? (row?.holder === 'apple' ? row.slug : null);

  // Is the web side still paid for? A live card plan, or Free. (A web account whose plan ended must not be told it "already has a plan".)
  const planLive = async (): Promise<boolean> => {
    if (reading.cardPlan) return true;
    try { return deps.isFree ? await deps.isFree(uid) : true; } catch { return true; }
  };
  if (reading.kind === 'mixed') return { may: false, reason: 'mixed', kind: 'mixed', slug: webSlug ?? appleSlug, environment, planLive: await planLive() };
  // An unpublished web row (a first publish in flight or failed) is not a web account yet.
  if (reading.kind === 'web' || (row?.holder === 'web' && row.published_once)) return { may: false, reason: 'web-account', kind: reading.kind, slug: webSlug, environment, planLive: await planLive() };
  // The Apple address sits on another purchase.
  if (row?.holder === 'apple') {
    // The purchase holding the slug counts only when it is THIS account's: a stale row (a failed Move hand-over) never refuses the old account.
    let holder: string | null = own.find((p) => p.site_slug === row.slug)?.original_transaction_id ?? null;
    if (!holder) { const p = await deps.purchaseOfSlug(row.slug); if (p && p.user_id === uid) holder = p.original_transaction_id; }
    if (holder && holder !== otid) return { may: false, reason: 'other-apple-id', kind: reading.kind, slug: row.slug, environment };
    if (holder) return { may: true };
    // A stale row: fall through to what the account's own purchases say.
  }
  const other = own.find((p) => p.original_transaction_id !== otid);
  if (other) return { may: false, reason: 'other-apple-id', kind: reading.kind, slug: other.site_slug, environment };
  return { may: true };
}

export type TieDecision =
  | { action: 'allow' }
  | { action: 'refuse'; reason: BlockReason; /** The address the account holds, '' when none (the body of a 409 account-has-site). */ slug: string; /** web-account / mixed: false = the account's web plan has ended. Absent for other-apple-id. */ planLive?: boolean }
  | { action: 'unavailable' };

export interface TieDeps {
  mode(): GuardMode;
  mayTake(uid: string, otid: string): Promise<MayTake>;
  report(info: BlockedInfo): Promise<void>;
}

/** What a tie point calls, BEFORE it writes anything. `where` names the tie point for the alert. */
export async function checkTie(uid: string, otid: string, where: string, deps: TieDeps = liveTieDeps()): Promise<TieDecision> {
  const mode = deps.mode();
  if (mode === 'off') return { action: 'allow' };
  let d: MayTake;
  try {
    d = await deps.mayTake(uid, otid);
  } catch (e: any) {
    console.error(`[one-site] ${where}: could not decide whether the account may take the purchase:`, e?.status ?? e?.message ?? e);
    return mode === 'enforce' ? { action: 'unavailable' } : { action: 'allow' };
  }
  if (d.may === true) return { action: 'allow' };
  // A refused Move or transfer link records and alerts only: the barber is not emailed about it (the Move screen already answers them).
  await deps.report({ otid, uid, reason: d.reason, slug: d.slug, environment: d.environment, planLive: d.planLive, email: mode === 'enforce' && !/^ios\/transfer/.test(where), where });
  return mode === 'enforce' ? { action: 'refuse', reason: d.reason, slug: d.slug ?? '', ...(d.planLive !== undefined ? { planLive: d.planLive } : {}) } : { action: 'allow' };
}

const enc = encodeURIComponent;
export function liveMayTakeDeps(): MayTakeDeps {
  const rest = async (path: string): Promise<any[]> => ((await sbRest(path)) ?? []) as any[];
  return {
    kindDeps: liveKindDeps(),
    env: defaultKindEnv, // throws on an unknown Stripe key: checkTie turns that into allow (alert) / unavailable (1)
    async address(uid, env) {
      try { return (await rest(`account_sites?user_id=eq.${enc(uid)}&environment=eq.${env}&select=user_id,environment,slug,holder,published_once&limit=1`))[0] ?? null; }
      catch (e: any) { if (tableMissing(e)) return null; throw e; }
    },
    async purchase(otid) { return (await rest(`ios_purchases?original_transaction_id=eq.${enc(otid)}&select=original_transaction_id,user_id,environment&limit=1`))[0] ?? null; },
    async isFree(uid) { return (await readStoredGroup(uid)) === 'free'; },
    async purchaseOfSlug(slug) { return (await rest(`ios_purchases?site_slug=eq.${enc(slug)}&select=original_transaction_id,user_id&limit=1`))[0] ?? null; },
  };
}
export function liveTieDeps(): TieDeps {
  return { mode: () => guardMode(), mayTake: (uid, otid) => mayTakePurchase(uid, otid), report: (info) => reportBlocked(info) };
}

/** The dep flows take: (uid, otid, where) -> decision. Live wiring. */
export const liveTie = (uid: string, otid: string, where: string): Promise<TieDecision> => checkTie(uid, otid, where);
export type TieCheck = (uid: string, otid: string, where: string) => Promise<TieDecision>;
