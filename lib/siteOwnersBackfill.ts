// Backfill of the web site owner list (013 site_owners) from past Stripe checkout sessions:
// metadata.siteId + the checkout email -> the Supabase account with that CONFIRMED email.
// Pure planner here (tested with fakes); scripts/backfill-site-owners.mjs fetches the sessions and
// accounts and applies the plan (dry run unless --yes).
//
// Rules:
// - Only paid, complete, subscription-mode aibarber sessions with a siteId count (the same
//   sessions lib/deployAuth.ts accepts as checkout proof; a domain purchase never does).
// - A slug whose sessions name more than one email is reported and skipped (ambiguous: the
//   admin decides with set-web-owner).
// - A slug that already has an owner row is skipped (never replaced); an iOS app slug too.
// - A confirmed account with exactly that email becomes the owner. Otherwise (no account, or
//   one whose email is unconfirmed) the email is stored to be claimed at a confirmed sign-in:
//   an unconfirmed account may be someone who pre-registered the buyer's address.
import { slugify } from './publishSite.js';
import { normEmail, type SiteOwnerRow } from './siteOwners.js';

export interface BackfillSession {
  id: string;
  mode: string | null;
  status: string | null;
  paymentStatus: string | null;
  app: string | null;
  siteId: string | null;
  email: string | null;
  /** Unix seconds. */
  created: number;
}

export interface BackfillAccount { id: string; emailConfirmed: boolean }

export interface BackfillPlan {
  insert: SiteOwnerRow[];
  skipped: { slug: string; reason: 'already-owned' | 'app-site' | 'several-emails' | 'no-email'; detail?: string }[];
  /** Sessions that are not site checkouts (counted, not listed). */
  ignoredSessions: number;
}

export function planBackfill(
  sessions: BackfillSession[],
  ctx: {
    accountByEmail: Map<string, BackfillAccount>;
    owned: Set<string>;
    appSlugs: Set<string>;
  },
): BackfillPlan {
  const bySlug = new Map<string, BackfillSession[]>();
  let ignored = 0;
  for (const s of sessions) {
    const slug = slugify(s.siteId || '');
    if (s.mode !== 'subscription' || s.status !== 'complete' || s.paymentStatus !== 'paid' || s.app !== 'aibarber' || !slug) {
      ignored++;
      continue;
    }
    bySlug.set(slug, [...(bySlug.get(slug) ?? []), s]);
  }
  const plan: BackfillPlan = { insert: [], skipped: [], ignoredSessions: ignored };
  for (const slug of [...bySlug.keys()].sort()) {
    const list = bySlug.get(slug)!.sort((a, b) => a.created - b.created);
    if (ctx.owned.has(slug)) { plan.skipped.push({ slug, reason: 'already-owned' }); continue; }
    if (ctx.appSlugs.has(slug)) { plan.skipped.push({ slug, reason: 'app-site' }); continue; }
    const emails = [...new Set(list.map((s) => normEmail(s.email)).filter((e): e is string => !!e))];
    if (emails.length === 0) { plan.skipped.push({ slug, reason: 'no-email' }); continue; }
    if (emails.length > 1) { plan.skipped.push({ slug, reason: 'several-emails', detail: emails.join(', ') }); continue; }
    const email = emails[0];
    const account = ctx.accountByEmail.get(email);
    const first = list[0];
    plan.insert.push({
      slug,
      user_id: account?.emailConfirmed ? account.id : null,
      claim_email: account?.emailConfirmed ? null : email,
      source: 'backfill',
      checkout_session_id: first.id,
    });
  }
  return plan;
}

/** A Stripe Checkout Session object -> BackfillSession. */
export function toBackfillSession(s: any): BackfillSession {
  return {
    id: String(s?.id ?? ''),
    mode: typeof s?.mode === 'string' ? s.mode : null,
    status: typeof s?.status === 'string' ? s.status : null,
    paymentStatus: typeof s?.payment_status === 'string' ? s.payment_status : null,
    app: typeof s?.metadata?.app === 'string' ? s.metadata.app : null,
    siteId: (typeof s?.metadata?.siteId === 'string' && s.metadata.siteId) || (typeof s?.client_reference_id === 'string' && s.client_reference_id) || null,
    email: (typeof s?.customer_details?.email === 'string' && s.customer_details.email) || (typeof s?.customer_email === 'string' && s.customer_email) || null,
    created: typeof s?.created === 'number' ? s.created : 0,
  };
}
