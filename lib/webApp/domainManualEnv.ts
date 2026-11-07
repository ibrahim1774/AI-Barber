// Live wiring of the manual web-domain fulfilment (lib/webApp/domainManual.ts): Resend, the order
// inbox, the link secret and the lookups the mails need. No Stripe write, no registrar, no Vercel write here.
//
// Env (names only):
//   DOMAIN_ORDERS_EMAIL        where the order / reminder / ended mails go (default ibrahim3709@gmail.com)
//   DOMAIN_ADMIN_LINK_SECRET   HMAC key of the Mark live / Can't get this name / Mark ended links (no secret = no links, the action endpoint answers 503)
//   DOMAIN_ADMIN_LINK_BASE     origin that serves /api/web-app/domain-action (default: the production URL of this deployment)
//   VERCEL_TEAM_SLUG           optional, for dashboard links in the order mail
//   DOMAIN_LIVE_VERIFY_STUB    staging only (test Stripe key, DOMAINS_BUY_DISABLED=1, not production): Mark live skips the Vercel / HTTPS checks
import { sendMail } from './emails.js';
import { emailOfUser } from './userExists.js';
import { APP_ORIGIN, sbRest } from './webAppServer.js';
import { readPendingSite } from '../publishSite.js';
import { stampedSiteUrl } from '../ios/siteUrlFor.js';
import { domainsBuyDisabled } from '../ios/vercelDomains.js';
import { keyMode } from './stripeCore.js';
import type { ManualDeps } from './domainManual.js';

export const DEFAULT_ORDERS_EMAIL = 'ibrahim3709@gmail.com';

/** Stub only with a test Stripe key, DOMAINS_BUY_DISABLED=1 (which production ignores) and the flag itself. */
export function verifyStubOn(env: Record<string, string | undefined> = process.env): boolean {
  return env.DOMAIN_LIVE_VERIFY_STUB === '1' && domainsBuyDisabled(env) && keyMode(env.STRIPE_SECRET_KEY) === 'test';
}

export function linkBase(env: Record<string, string | undefined> = process.env): string {
  if (env.DOMAIN_ADMIN_LINK_BASE) return env.DOMAIN_ADMIN_LINK_BASE;
  if (env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`;
  return APP_ORIGIN();
}

async function customerOf(slug: string): Promise<{ email: string | null; shopName: string | null }> {
  let email: string | null = null;
  try {
    const rows: Array<{ user_id: string | null }> = (await sbRest(`web_app_sites?slug=eq.${encodeURIComponent(slug)}&select=user_id&limit=1`)) ?? [];
    if (rows[0]?.user_id) email = await emailOfUser(rows[0].user_id);
  } catch { /* best effort */ }
  if (!email) {
    try {
      const rows: Array<{ owner_email?: string | null; claim_email?: string | null }> = (await sbRest(`site_owners?slug=eq.${encodeURIComponent(slug)}&select=owner_email,claim_email&limit=1`)) ?? [];
      email = rows[0]?.owner_email || rows[0]?.claim_email || null;
    } catch { /* best effort */ }
  }
  let shopName: string | null = null;
  try { shopName = (await readPendingSite(slug))?.siteData?.shopName ?? null; } catch { /* best effort */ }
  return { email, shopName };
}

export function liveManualDeps(opts: { getSubscription?: (id: string) => Promise<any | null> } = {}): ManualDeps {
  return {
    async sendMail(to, mail, key) { await sendMail(to, mail, fetch, key); },
    ordersEmail: process.env.DOMAIN_ORDERS_EMAIL || DEFAULT_ORDERS_EMAIL,
    linkSecret: process.env.DOMAIN_ADMIN_LINK_SECRET || '',
    linkBase: linkBase(),
    appOrigin: APP_ORIGIN(),
    customerOf,
    liveUrlOf: (slug) => stampedSiteUrl(slug),
    teamSlug: process.env.VERCEL_TEAM_SLUG || null,
    verifyStub: verifyStubOn(),
    getSubscription: opts.getSubscription,
    async fetchCanonical(domain) {
      const r = await fetch(`https://${domain}/`, { redirect: 'follow', signal: AbortSignal.timeout(6_000) });
      const html = await r.text();
      const m = /<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["']/i.exec(html) || /<link[^>]+href=["']([^"']+)["'][^>]*rel=["']canonical["']/i.exec(html);
      return m ? m[1].slice(0, 300) : null;
    },
  };
}
