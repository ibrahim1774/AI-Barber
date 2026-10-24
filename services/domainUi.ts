// The website's custom-domain panel (components/DomainManager.tsx): plain helpers, testable.
import { isComDomain, normalizeLabel } from '../lib/ios/domainNames';

export const DOMAIN_PRICE_LABEL = '$39/year';
export const DOMAIN_DISCLOSURE =
  "Registered by Prime Barber for your site. If you ever leave, contact support@davoxa.com and we'll transfer it to you.";
export const DOMAIN_CANCEL_NOTE =
  'Cancelling stops next year\'s renewal. Your domain keeps working until the end of the year you already paid for, then your site goes back to its free address.';

const PENDING_KEY = 'aib_domain_checkout';

/** Called on the Stripe success return (?domain_payment=success&session_id=…). */
export function rememberDomainCheckout(sessionId: string | null | undefined): void {
  if (!sessionId || !/^cs_(test|live)_[A-Za-z0-9_]{8,200}$/.test(sessionId)) return;
  try {
    sessionStorage.setItem(PENDING_KEY, sessionId);
  } catch { /* private mode: the webhook still finishes the purchase */ }
}

export function takeDomainCheckout(): string | null {
  try {
    const v = sessionStorage.getItem(PENDING_KEY);
    return v && /^cs_(test|live)_[A-Za-z0-9_]{8,200}$/.test(v) ? v : null;
  } catch {
    return null;
  }
}

export function clearDomainCheckout(): void {
  try {
    sessionStorage.removeItem(PENDING_KEY);
  } catch { /* ignore */ }
}

/** What the barber typed → the exact `.com` we'd ask for, or null. ".com" only. */
export function comDomainFrom(input: string): string | null {
  const t = (input || '').trim().toLowerCase();
  if (/\.[a-z]+$/.test(t.replace(/^https?:\/\//, '').replace(/\/.*$/, '')) && !/\.com\/?$/.test(t)) return null;
  const label = normalizeLabel(t);
  return label && isComDomain(`${label}.com`) ? `${label}.com` : null;
}

/** The site id the server authorises: the site's own vercel.app label, else its shop-name slug. */
export function domainSiteId(site: { deployedUrl: string | null; data: { shopName?: string } }): string {
  try {
    const host = site.deployedUrl ? new URL(site.deployedUrl).hostname.toLowerCase() : '';
    if (host.endsWith('.vercel.app')) return host.split('.')[0];
  } catch { /* fall through */ }
  return (site.data.shopName || '').toLowerCase().replace(/['’`]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);
}

export type PanelView =
  | { kind: 'none' }
  | { kind: 'progress'; step: 'registering' | 'linking' | 'pointing'; domain: string }
  | { kind: 'live'; domain: string; cancelledUntil: string | null }
  | { kind: 'refunded'; domain: string | null; message: string }
  | { kind: 'failed'; domain: string | null; reason: string }
  | { kind: 'expired'; domain: string };

export const REFUNDED_FALLBACK = 'That name was taken just before your payment went through. Your $39 has been refunded in full and the subscription cancelled; please pick another name.';

/** The server's status body (lib/ios/domainFlow.ts statusBody) → what the panel shows. */
export function panelView(b: any): PanelView {
  const state = String(b?.state || 'none');
  const domain = typeof b?.domain === 'string' ? b.domain : null;
  if (b?.refunded) return { kind: 'refunded', domain, message: typeof b.message === 'string' ? b.message : REFUNDED_FALLBACK };
  if (!domain || state === 'none') return { kind: 'none' };
  if (state === 'registering') return { kind: 'progress', step: 'registering', domain };
  if (state === 'linking') return { kind: 'progress', step: 'linking', domain };
  if (state === 'live') {
    // Live but DNS/SSL not ready yet → "live in a few minutes".
    if (b?.vercel && (b.vercel.dnsOk === false || b.vercel.ssl === 'pending')) return { kind: 'progress', step: 'pointing', domain };
    return { kind: 'live', domain, cancelledUntil: null };
  }
  if (state.startsWith('cancelled-until:')) return { kind: 'live', domain, cancelledUntil: state.slice('cancelled-until:'.length) };
  if (state.startsWith('failed:')) return { kind: 'failed', domain, reason: state.slice('failed:'.length) };
  if (state === 'expired') return { kind: 'expired', domain };
  return { kind: 'none' };
}

export const STEP_LABEL = { registering: 'Registering your domain…', linking: 'Linking it to your site…', pointing: 'Live in a few minutes (setting up the address and security)…' } as const;
