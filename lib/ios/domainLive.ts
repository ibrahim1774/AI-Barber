// Production wiring for the custom-domain endpoints, the notification sink and the sweep step.
//
// Env:
//   VERCEL_TOKEN               (existing) needs registrar + project scope on the team that owns the site projects
//   VERCEL_DOMAINS_TEAM_ID     optional; only if the token's default scope is NOT that team (deploys send no teamId)
//   VERCEL_REGISTRANT_CONTACT  JSON registrant contact (lib/ios/vercelDomains.ts registrantContact); no purchase without it
//   DOMAINS_SANDBOX_REAL_OTIDS optional, comma-separated Sandbox originalTransactionIds allowed to buy for real (internal tests)
import { liveGetUser } from '../bookings/auth.js';
import { publicLimiter } from '../bookings/rateLimit.js';
import { serviceClient, supabaseBookingRepo } from '../bookings/repo.js';
import { publishSite, readPendingSite } from '../publishSite.js';
import { lazyDefaultVerifier } from './appleVerify.js';
import { applyDomainNotification, sweepDomains, type DomainFlowDeps, type DomainSweepSummary } from './domainFlow.js';
import { makeDomainHooks } from './domainHooks.js';
import { supabaseDomains } from './domainsRepo.js';
import type { DomainNotificationSink } from './notifications.js';
import { supabasePurchases } from './purchases.js';
import { DOMAIN_PRODUCT_ID } from './tiers.js';
import { liveVercelDomains, registrantContact } from './vercelDomains.js';

export function sandboxRealOtids(raw: string | undefined = process.env.DOMAINS_SANDBOX_REAL_OTIDS): Set<string> {
  return new Set((raw || '').split(',').map((s) => s.trim()).filter(Boolean));
}

async function probeHttps(domain: string): Promise<boolean> {
  try {
    const r = await fetch(`https://${domain}/`, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(5_000) });
    return r.status > 0 && r.status < 500;
  } catch {
    return false; // no certificate yet, DNS not propagated, …
  }
}

export function liveDomainDeps(): DomainFlowDeps {
  const client = serviceClient();
  const purchases = supabasePurchases(client);
  const shops = supabaseBookingRepo(client);
  return {
    repo: supabaseDomains(client),
    vercel: liveVercelDomains(),
    contact: registrantContact(),
    // The domain product ONLY (never a site product), with the Apple account's other purchases.
    verifyDomain: lazyDefaultVerifier({ products: [DOMAIN_PRODUCT_ID], includeAccount: true }),
    // The site verifier: the six site products only (never the domain product).
    verifySite: lazyDefaultVerifier(),
    sitePurchase: (otid) => purchases.get(otid),
    getUser: liveGetUser(client),
    shopOtidOf: async (userId) => (await shops.shopByOwner(userId))?.ios_otid ?? null,
    hooks: makeDomainHooks({
      findBySlug: (slug) => purchases.findBySlug(slug),
      readPending: readPendingSite,
      publish: (slug, opts) => publishSite(slug, opts),
      now: Date.now,
      takedownSandbox: process.env.IOS_TAKEDOWN_SANDBOX === '1',
      // site-subpages: setSiteBaseUrl → ab_shops.site_base_url (see lib/ios/domainHooks.ts).
    }),
    limiter: publicLimiter,
    now: Date.now,
    sandboxRealOtids: sandboxRealOtids(),
    probeHttps,
  };
}

/** The domain half of App Store Server Notifications (lib/ios/notifications.ts routes the domain product here). */
export function liveDomainNotificationSink(): DomainNotificationSink {
  let repo: ReturnType<typeof supabaseDomains> | undefined;
  return {
    applyNotification: (n) => applyDomainNotification(n, { repo: (repo ??= supabaseDomains(serviceClient())), now: Date.now }),
  };
}

/** The domain step of /api/ios/sweep. Never throws: a domain problem must not fail the site sweep. */
export async function runDomainSweep(deadline: number): Promise<DomainSweepSummary | { error: string }> {
  try {
    return await sweepDomains(liveDomainDeps(), { deadline });
  } catch (e: any) {
    console.error('[Sweeper:domains] threw:', e?.message || e);
    return { error: e?.message || 'domain sweep failed' };
  }
}
