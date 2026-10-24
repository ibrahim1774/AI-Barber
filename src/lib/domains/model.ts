/**
 * Custom domains (spec 2026-10-22-custom-domains, server: /api/ios/domain/{search,claim,status}).
 * Pure: the status body as the app shows it, the claim answers, and the copy. No monthly
 * equivalent of the yearly price anywhere.
 */

export const DOMAIN_PRODUCT_ID = 'com.ibrahim1774.aibarber.domain.yearly';
export const DOMAIN_ENTITLEMENT = 'domain';
export const DOMAIN_PLACEMENT = 'custom_domain';

export const DOMAIN_PRICE_LINE = 'Get your own .com — $39/year';
export const DOMAIN_DISCLOSURE =
  "Registered by Prime Barber for your site. If you ever leave, contact support@davoxa.com and we'll transfer it to you.";
/** Shown only as muted fine print at the bottom of the domain screen, not in the main view. */
export const DOMAIN_EXAMPLES_LABEL = 'Examples';
export const DOMAIN_EXAMPLES = ['jagsbarbershop.com', 'eileensbarbercuts.com', 'donaldsbarbers.com'];
export const DOMAIN_EXAMPLES_LINE = DOMAIN_EXAMPLES.join(' · ');
export const DOMAIN_SUPPORT_LINE = "Something needs a hand on our side. Email support@davoxa.com and we'll sort it out.";

export type SearchResult = { domain: string; available: boolean; eligible: boolean };

export type DomainStatus = {
  domain: string | null;
  state: string;
  url?: string;
  paidUntil?: string | null;
  autoRenew?: boolean;
  sandbox?: boolean;
  canRetry?: boolean;
  needsSupport?: boolean;
  vercel?: { verified: boolean | null; dnsOk: boolean | null; ssl: 'ready' | 'pending' | null };
};

export type Phase =
  | 'none' | 'registering' | 'linking' | 'almost' | 'live' | 'cancelled' | 'expired' | 'failed' | 'transferred';

export type StatusView = {
  phase: Phase;
  title: string;
  detail?: string;
  /** Keep polling status. */
  polling: boolean;
  /** Call claim again with the same name. */
  retrySame: boolean;
  /** The paid slot is free again: pick another name without paying. */
  pickAnother: boolean;
  needsSupport: boolean;
  /** The domain subscription ended: renew through the domain paywall, which re-attaches the same name. */
  renew: boolean;
  /** SSL pending: poll slower, and stop after a while with a "check back soon" note. */
  slowPoll?: boolean;
};

const FAILED: Record<string, string> = {
  taken: 'That name was taken before we could get it.',
  price: "That name isn't available at the standard price.",
  registrar: "The registrar couldn't complete it.",
  'subscription-inactive': "Your domain subscription isn't active.",
  'registration-expired': 'The registration for that name ran out.',
};

export function formatDay(iso: string | null | undefined): string {
  const t = Date.parse(iso ?? '');
  if (Number.isNaN(t)) return '';
  return new Date(t).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

/** The status body (or a claim answer's body) as the progress screen and the Settings row show it. */
export function statusView(s: DomainStatus | null | undefined): StatusView {
  const base = { polling: false, retrySame: false, pickAnother: false, renew: false, needsSupport: !!s?.needsSupport };
  const state = s?.state ?? 'none';
  if (state === 'registering') return { ...base, phase: 'registering', title: 'Registering…', polling: true };
  if (state === 'linking') return { ...base, phase: 'linking', title: 'Linking…', polling: true };
  if (state === 'live') {
    return s?.vercel?.ssl === 'pending'
      ? { ...base, phase: 'almost', title: 'Live in a few minutes', detail: 'Setting up the secure connection.', polling: true, slowPoll: true }
      : { ...base, phase: 'live', title: 'Live' };
  }
  if (state.startsWith('cancelled-until:')) {
    const day = formatDay(state.slice('cancelled-until:'.length));
    return { ...base, phase: 'cancelled', title: day ? `Cancelled — works until ${day}` : 'Cancelled' };
  }
  if (state === 'expired') {
    return { ...base, phase: 'expired', title: 'Expired', detail: 'Renew to bring this name back to your site.', renew: true };
  }
  if (state === 'transferred') return { ...base, phase: 'transferred', title: 'Transferred to you', needsSupport: base.needsSupport };
  if (state.startsWith('failed:')) {
    const reason = state.slice('failed:'.length);
    if (reason === 'subscription-inactive') {
      return { ...base, phase: 'failed', title: "Your domain subscription isn't active", detail: 'Renew it to finish getting this name.', renew: true };
    }
    // A failed claim leaves the paid slot unused: same name again (canRetry) or another name, no new payment.
    const reusable = !!s?.canRetry || reason === 'registration-expired' || reason === 'taken' || reason === 'price';
    return {
      ...base,
      phase: 'failed',
      title: "Couldn't get that name — pick another",
      detail: FAILED[reason] ?? 'Something went wrong getting that name.',
      retrySame: !!s?.canRetry && reason !== 'taken' && reason !== 'price' && reason !== 'registration-expired' && reason !== 'subscription-inactive',
      pickAnother: reusable && reason !== 'subscription-inactive',
    };
  }
  return { ...base, phase: 'none', title: DOMAIN_PRICE_LINE };
}

/** The Settings row's detail: the domain and its state, or the offer. */
export function settingsDetail(s: DomainStatus | null | undefined): string {
  if (!s?.domain || (s.state ?? 'none') === 'none') return DOMAIN_PRICE_LINE;
  return `${s.domain} · ${statusView(s).title}`;
}

export type ClaimOutcome =
  | { kind: 'live' | 'progress' | 'failed'; status: DomainStatus }
  | { kind: 'taken' | 'not-eligible' }
  | { kind: 'slot-in-use'; status: DomainStatus | null }
  | { kind: 'support'; code: string }
  | { kind: 'inactive' }
  | { kind: 'retry-later'; code: string };

/** What a claim answer means for the screen. */
export function claimOutcome(httpStatus: number, body: any): ClaimOutcome {
  const status = body && typeof body === 'object' && typeof body.state === 'string' ? (body as DomainStatus) : null;
  const code = typeof body?.error === 'string' ? body.error : `http-${httpStatus}`;
  if (httpStatus === 200 && status) return { kind: status.state === 'live' ? 'live' : 'progress', status };
  if (httpStatus === 202 && status) return { kind: 'progress', status };
  if (httpStatus === 409) {
    if (code === 'claim-failed' && status) return { kind: 'failed', status };
    if (code === 'domain-taken') return { kind: 'taken' };
    if (code === 'domain-not-eligible') return { kind: 'not-eligible' };
    if (code === 'slot-in-use') return { kind: 'slot-in-use', status };
    if (body?.needsSupport) return { kind: 'support', code };
    // slot-bound-to-other-site, site-has-domain, transferred: nothing the barber can do in the app.
    return { kind: 'support', code };
  }
  if (httpStatus === 402) return { kind: 'inactive' };
  if (httpStatus === 400 && (code === 'invalid' || code === 'bad-bundle')) return { kind: 'retry-later', code };
  if (httpStatus === 403 || httpStatus === 404 || code === 'bad-product') return { kind: 'support', code };
  return { kind: 'retry-later', code };
}

/** The exact .com label the server will search for (the server normalises again; this is for display). */
export function normalizeLabel(q: string): string {
  return q
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\.com$/, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9-]/g, '');
}

/** Only names the server marks eligible can be bought. */
export const buyable = (r: SearchResult): boolean => r.available && r.eligible;

/** A pending or finished claim the app remembers (survives a kill): which slot and which name. */
export type DomainClaimRecord = { transactionId: string; domain: string; siteTransactionId?: string };

/** Claim answers that are not "offline": each gets its own words. */
export function retryLaterMessage(code: string): string {
  if (code === 'network') return "Couldn't reach Prime Barber. Check your connection and try again — you won't pay twice.";
  if (code === 'rate-limited') return 'Too many tries. Wait a minute and try again.';
  if (code === 'invalid' || code === 'bad-bundle') return "That name can't be used. Pick another.";
  if (code === 'domains-unavailable') return "Custom domains aren't available right now. Try again later — you won't pay twice.";
  return "Prime Barber is busy right now. Try again in a minute — you won't pay twice.";
}

/**
 * The remembered claim, if it still belongs here: the active domain subscription (when one is active)
 * and this site. A record for another subscription or another site is dropped.
 */
export function rememberedClaim(
  rec: DomainClaimRecord | null,
  activeDomainTx: string | null,
  siteTx: string | null,
): DomainClaimRecord | null {
  if (!rec) return null;
  if (activeDomainTx && rec.transactionId !== activeDomainTx) return null;
  if (rec.siteTransactionId && siteTx && rec.siteTransactionId !== siteTx) return null;
  return rec;
}

/** The newest active domain subscription's transaction id (CustomerInfo.subscriptions). */
export function pickDomainTransactionId(
  subs: { transactionId: string; productId: string; purchaseDate: string; isActive: boolean; isRevoked?: boolean }[],
): string | null {
  let best: string | null = null;
  let at = -Infinity;
  for (const s of subs) {
    if (s.productId !== DOMAIN_PRODUCT_ID || !s.isActive || s.isRevoked) continue;
    const t = Date.parse(s.purchaseDate);
    if (!best || (Number.isNaN(t) ? 0 : t) > at) {
      best = s.transactionId;
      at = Number.isNaN(t) ? 0 : t;
    }
  }
  return best;
}
