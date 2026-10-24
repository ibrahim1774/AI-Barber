// Who may open a site Checkout for a slug (review fix round 1 finding 2, narrowed in re-review R1).
//
// A paid checkout is deploy proof for its slug (lib/deployAuth.ts), but since fix round 1 a
// checkout is never proof against the owner list there: with an owner row, only the row's own
// session (or a checkout paid with the owner's email, R2) counts. So the only checkout worth
// refusing up front is one for a slug that HAS an owner, by someone who isn't that owner (signed
// in) or the admin: it could never deploy, and the payer would have paid for nothing.
// Published slugs with no owner row stay open (re-checkout after a lapse before the backfill, a
// shop name that matches an old project): deployAuth decides those deploys.
//
// Fails OPEN on a lookup error (logged): a Supabase or auth hiccup must not stop every sale, and
// refusing here protects nobody's site (deployAuth does).
import { ADMIN_EMAIL } from './admin/auth.js';
import { bearerOf, type DeployUser } from './deployAuth.js';
import { slugify } from './publishSite.js';
import { webOwnerDecision, type SiteOwnerStore } from './siteOwners.js';

/**
 * Fixed siteIds of checkouts that are not a site's own (funnels that create the site later):
 * PrimeBarberLanding ('primebarber-landing'), PrePaymentBanner before the site is prepared
 * ('pre-publish') and the custom-design Google Form plan ('custom-design-request'). Never refused.
 */
export const FUNNEL_SITE_IDS: ReadonlySet<string> = new Set(['primebarber-landing', 'pre-publish', 'custom-design-request']);

export interface CheckoutGuardDeps {
  userOf(token: string): Promise<DeployUser | null>;
  siteOwners?: SiteOwnerStore;
  now(): number;
}

export type CheckoutGuardResult = { ok: true; slug: string } | { ok: false; status: 400 | 409; error: string };

export async function checkoutSlugAllowed(siteId: unknown, authorization: unknown, deps: CheckoutGuardDeps): Promise<CheckoutGuardResult> {
  const slug = slugify(String(siteId ?? ''));
  if (!slug) return { ok: false, status: 400, error: 'Invalid siteId' };
  if (FUNNEL_SITE_IDS.has(slug) || !deps.siteOwners) return { ok: true, slug };
  try {
    const row = await deps.siteOwners.get(slug);
    if (!row) return { ok: true, slug };
    const token = bearerOf(authorization);
    const user = token ? await deps.userOf(token) : null;
    if (user && (user.email || '').toLowerCase() === ADMIN_EMAIL) return { ok: true, slug };
    if (user && (await webOwnerDecision(slug, user, deps.siteOwners, deps.now)) === 'owner') return { ok: true, slug };
    console.warn(`[checkout] ${slug} has an owner; refusing a checkout from ${user ? user.id : 'a signed-out caller'}`);
    return { ok: false, status: 409, error: 'site-owned' };
  } catch (e: any) {
    console.error(`[checkout] ${slug}: owner check failed; allowing the checkout (deploys are still authorised):`, e?.message || e);
    return { ok: true, slug };
  }
}
