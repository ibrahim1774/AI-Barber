// Who may open a site Checkout for a slug (review fix round 1, finding 2).
//
// A paid checkout is proof for /api/deploy-site for 7 days. create-checkout-session takes the
// siteId from the browser, so before this anyone could pay once for someone else's live slug and
// deploy over it. Now a slug that is already published (a server deployedUrl stamp on its stored
// copy, or an existing Vercel project) can be checked out only by its owner (owner list, signed
// in) or the admin; a new slug is open to anyone, as before. Lookups fail closed (503).
import { ADMIN_EMAIL } from './admin/auth.js';
import { bearerOf, type DeployUser } from './deployAuth.js';
import { slugify } from './publishSite.js';
import { webOwnerDecision, type SiteOwnerStore } from './siteOwners.js';

export interface CheckoutGuardDeps {
  storedStamp(slug: string): Promise<string | null>;
  projectExists(slug: string): Promise<boolean>;
  userOf(token: string): Promise<DeployUser | null>;
  siteOwners?: SiteOwnerStore;
  now(): number;
}

export type CheckoutGuardResult = { ok: true; slug: string } | { ok: false; status: 400 | 409 | 503; error: string };

export async function checkoutSlugAllowed(siteId: unknown, authorization: unknown, deps: CheckoutGuardDeps): Promise<CheckoutGuardResult> {
  const slug = slugify(String(siteId ?? ''));
  if (!slug) return { ok: false, status: 400, error: 'Invalid siteId' };
  try {
    const [stamp, exists] = await Promise.all([deps.storedStamp(slug), deps.projectExists(slug)]);
    if (!stamp && !exists) return { ok: true, slug };
    const token = bearerOf(authorization);
    const user = token ? await deps.userOf(token) : null;
    if (user && (user.email || '').toLowerCase() === ADMIN_EMAIL) return { ok: true, slug };
    if (user && deps.siteOwners && (await webOwnerDecision(slug, user, deps.siteOwners, deps.now)) === 'owner') return { ok: true, slug };
    console.warn(`[checkout] ${slug} is already published; refusing a checkout from ${user ? user.id : 'a signed-out caller'}`);
    return { ok: false, status: 409, error: 'site-published' };
  } catch (e: any) {
    console.error(`[checkout] ${slug}: published check failed (refusing):`, e?.message || e);
    return { ok: false, status: 503, error: 'temporarily-unavailable' };
  }
}
