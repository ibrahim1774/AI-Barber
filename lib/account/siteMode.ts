// Site mode (one-account plan, lane C2). Who may use the account draft store and the drafted publish from a native app.
//   'account'  : kind 'web' AND the switch covers the user. The phone uses the draft store and the account publish.
//   'web-only' : kind 'web' and NOT covered (including when ACCOUNT_DRAFTS_IOS is fully off): a web account is never 'device'.
//   'device'   : everything else (apple, mixed, neither). Never 'account' for those.
// Switch: ACCOUNT_DRAFTS_IOS = 'allowlist' (with ACCOUNT_DRAFTS_IOS_USERS, comma-separated user ids) | 'all' | anything else = off.
// The kind is the DECISION reading of lib/account/kind.ts. siteModeOf THROWS on a lookup failure (and when the Stripe key cannot decide the
// environment): a native caller then fails closed (503), never falls through to device behaviour for a web account.
// A request counts as native only when the X-PB-Build header is present (nativeBuild); browsers never send it.
import type { AccountKind } from './kind.js';

export type SiteMode = 'device' | 'account' | 'web-only';
/** What GET /api/shop/plan can say: a SiteMode, or 'unknown' when ACCOUNT_PLAN_V2 is on and the account lookup failed. siteModeOf and siteModeFromKind never return 'unknown'. */
export type PlanSiteMode = SiteMode | 'unknown';

export function accountDraftsCovers(uid: string, env: Record<string, string | undefined> = process.env): boolean {
  const v = env.ACCOUNT_DRAFTS_IOS;
  if (v === 'all') return true;
  if (v === 'allowlist') return (env.ACCOUNT_DRAFTS_IOS_USERS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean).includes(uid.toLowerCase());
  return false;
}

/** Pure. */
export function siteModeFromKind(kind: AccountKind, uid: string, env: Record<string, string | undefined> = process.env): SiteMode {
  if (kind !== 'web') return 'device';
  return accountDraftsCovers(uid, env) ? 'account' : 'web-only';
}

export async function siteModeOf(uid: string, deps: { kind?(uid: string): Promise<AccountKind>; env?: Record<string, string | undefined> } = {}): Promise<SiteMode> {
  const kind = deps.kind ? await deps.kind(uid) : await (async () => {
    const [{ accountKind }, { defaultKindEnv }] = await Promise.all([import('./kind.js'), import('./plan.js')]);
    return accountKind(uid, defaultKindEnv());
  })();
  return siteModeFromKind(kind, uid, deps.env);
}

/** The X-PB-Build header (any case), trimmed; null when absent or empty. */
export function nativeBuild(req: { headers?: Record<string, unknown> }): string | null {
  const v = req?.headers?.['x-pb-build'];
  const s = (Array.isArray(v) ? v[0] : v);
  return typeof s === 'string' && s.trim() ? s.trim() : null;
}

export type NativeGate = { status: 403 | 503; body: { error: string } };
/**
 * Draft GET/PUT and the drafted publish: a native caller whose mode is not 'account' is refused (403 not-account-mode); a lookup failure
 * is 503. A request without the header returns null at once and reads NOTHING.
 */
export async function nativeModeGate(req: { headers?: Record<string, unknown> }, uid: string, deps?: Parameters<typeof siteModeOf>[1]): Promise<NativeGate | null> {
  if (!nativeBuild(req)) return null;
  try {
    return (await siteModeOf(uid, deps)) === 'account' ? null : { status: 403, body: { error: 'not-account-mode' } };
  } catch (e: any) {
    console.error('[site mode] lookup failed for a native caller (refusing):', e?.message || e);
    return { status: 503, body: { error: 'temporarily-unavailable' } };
  }
}

/**
 * /api/web-app/delete-account: a native caller (X-PB-Build) whose mode is 'account' or 'web-only' (a web account) may delete through the web route; a
 * 'device' caller keeps /api/ios/delete-account and is refused here (403 not-account-mode). No header: null at once, nothing read. Lookup failure: 503.
 */
export async function nativeDeleteGate(req: { headers?: Record<string, unknown> }, uid: string, deps?: Parameters<typeof siteModeOf>[1]): Promise<NativeGate | null> {
  if (!nativeBuild(req)) return null;
  try {
    return (await siteModeOf(uid, deps)) === 'device' ? { status: 403, body: { error: 'not-account-mode' } } : null;
  } catch (e: any) {
    console.error('[site mode] lookup failed for a native delete (refusing):', e?.message || e);
    return { status: 503, body: { error: 'temporarily-unavailable' } };
  }
}

/** The account kind for the OLD iOS routes: an undecidable environment (missing or unknown Stripe key) reads as 'neither' (device), logged; never a 503 for an Apple-only caller. */
export async function oldRouteKind(uid: string): Promise<AccountKind> {
  const [{ accountKind }, { defaultKindEnv }] = await Promise.all([import('./kind.js'), import('./plan.js')]);
  let env;
  try { env = defaultKindEnv(); } catch (e: any) { console.error('[site mode] environment unknown, treating the caller as device on the old route:', e?.message || e); return 'neither'; }
  return accountKind(uid, env);
}

export type IosDestructive = { action: 'allow' } | { action: 'forceCancel' } | { action: 'respond'; status: 409 | 503; body: { error: string } };
/**
 * /api/ios/delete-account and /api/ios/take-offline. INVARIANT: no account is ever left without a working in-app delete, and no route deletes an account while leaving its
 * live card plan billing. Acts ONLY with ACCOUNT_PLAN_V2=1 AND X-PB-Build present (builds 55 and 1.1 and every header-less call are untouched; off: nothing is read) and a bearer.
 *  - kind web, delete: APP_DELETE_CANCELS_WEB=1 -> allow (that branch cancels the card plan). Else if the account route is unavailable (WEB_APP_ENTITLEMENTS off, so
 *    /api/web-app/* answers 404) -> forceCancel (the iOS delete cancels the card plan itself, the same code as the APP_DELETE_CANCELS_WEB branch). Else 409 use-account-delete.
 *  - kind mixed, delete: never refused (it resolves to device mode and has no other delete): allow with APP_DELETE_CANCELS_WEB=1, else forceCancel.
 *  - kind web, take offline: 409 use-account-take-offline only while the account route is available; otherwise allow (no billing is involved).
 *  - apple / neither: allow. A failed kind lookup is 503 (destructive routes fail closed).
 */
export async function iosDestructiveRoute(req: { headers?: Record<string, unknown> }, userOf: (token: string) => Promise<{ id: string } | null>, route: 'delete' | 'take-offline', deps?: { kind?(uid: string): Promise<AccountKind> }): Promise<IosDestructive> {
  if (process.env.ACCOUNT_PLAN_V2 !== '1' || !nativeBuild(req)) return { action: 'allow' };
  try {
    const h = req.headers?.authorization;
    const raw = Array.isArray(h) ? h[0] : h;
    const t = typeof raw === 'string' ? raw.replace(/^Bearer\s+/i, '').trim() : '';
    if (!t) return { action: 'allow' };
    const user = await userOf(t);
    if (!user?.id) return { action: 'allow' };
    const kind = await (deps?.kind ?? oldRouteKind)(user.id);
    const cancels = process.env.APP_DELETE_CANCELS_WEB === '1';
    const accountRoute = process.env.WEB_APP_ENTITLEMENTS === '1'; // /api/web-app/* answers 404 without it
    if (route === 'delete') {
      if (kind === 'mixed') return cancels ? { action: 'allow' } : { action: 'forceCancel' };
      if (kind === 'web') {
        if (cancels) return { action: 'allow' };
        return accountRoute ? { action: 'respond', status: 409, body: { error: 'use-account-delete' } } : { action: 'forceCancel' };
      }
      return { action: 'allow' };
    }
    return kind === 'web' && accountRoute ? { action: 'respond', status: 409, body: { error: 'use-account-take-offline' } } : { action: 'allow' };
  } catch (e: any) {
    console.error('[site mode] kind lookup failed on a destructive old route (refusing):', e?.message || e);
    return { action: 'respond', status: 503, body: { error: 'temporarily-unavailable' } };
  }
}

export type OldRouteGate = { status: 409 | 503; body: { error: string } };
/**
 * /api/ios/publish and /api/ios/site (Restore): a caller WITH X-PB-Build whose mode is not 'device' (account or web-only) must use the account publish (409
 * use-account-publish). No header: null at once, nothing read (builds 55 and 1.1 send none). No or invalid token: null (the flow answers 401).
 * A lookup failure for a native caller: 503.
 */
export async function oldRouteGate(req: { headers?: Record<string, unknown> }, userOf: (token: string) => Promise<{ id: string } | null>, deps?: Parameters<typeof siteModeOf>[1]): Promise<OldRouteGate | null> {
  if (!nativeBuild(req)) return null;
  // Active ONLY with ACCOUNT_PLAN_V2=1, the switch that makes the plan answer carry siteMode: the 1.2 app always sends the header, and with the switch
  // off it believes it is in device mode, so these routes must answer exactly as they do for a header-less call (no kind read, no refusal, no 503).
  if (process.env.ACCOUNT_PLAN_V2 !== '1') return null;
  try {
    const h = req.headers?.authorization;
    const token = (Array.isArray(h) ? h[0] : h);
    const t = typeof token === 'string' ? token.replace(/^Bearer\s+/i, '').trim() : '';
    if (!t) return null;
    const user = await userOf(t);
    if (!user?.id) return null;
    // Both 'account' and 'web-only' come from kind web: a web account never uses the old route.
    // The kind is decided WITHOUT defaultKindEnv() being able to 503 an Apple-only caller: a missing or unknown Stripe key makes the environment
    // undecidable, and then the caller is treated as device on these OLD routes only (logged). Any other failed read is still a 503.
    const kind = deps?.kind ?? oldRouteKind;
    return (await siteModeOf(user.id, { ...deps, kind })) !== 'device' ? { status: 409, body: { error: 'use-account-publish' } } : null;
  } catch (e: any) {
    console.error('[site mode] lookup failed for a native caller on the old route (refusing):', e?.message || e);
    return { status: 503, body: { error: 'temporarily-unavailable' } };
  }
}
