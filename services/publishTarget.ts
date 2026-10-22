// Pure helpers for the browser publish path (services/publishService.ts), kept
// free of browser/storage imports so they can be unit tested in node.
import type { WebsiteData } from '../types';

export const SUBSCRIPTION_ENDED_MESSAGE =
  "This site's subscription has ended. Open the AI Barber app to resubscribe and bring it back.";

/** Replace any remaining inline data: URL (at any depth) with ''; they belong in GCS, not in a request body. */
function stripDataUrls<T>(v: T): T {
  if (typeof v === 'string') return (/^\s*data:/i.test(v) ? '' : v) as T;
  if (Array.isArray(v)) return v.map(stripDataUrls) as T;
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, stripDataUrls(x)])) as T;
  }
  return v;
}

/**
 * The site data with uploaded image URLs substituted, as PublishOverlay saves
 * it after a publish (hero, about, gallery), plus staff photos. Sent to
 * /api/deploy-site so an iOS-bound site's stored copy matches what went live.
 */
export function withUploadedImageUrls(data: WebsiteData, imageUrlMap: Record<string, string>): WebsiteData {
  return stripDataUrls({
    ...data,
    hero: { ...data.hero, imageUrl: imageUrlMap['hero'] || data.hero?.imageUrl },
    about: { ...data.about, imageUrl: imageUrlMap['about'] || data.about?.imageUrl },
    gallery: (data.gallery || []).map((u, i) => imageUrlMap[`gallery${i}`] || u || ''),
    ...(data.staff
      ? { staff: data.staff.map((s, i) => ({ ...s, photo: imageUrlMap[`staff${i}`] || s?.photo })) }
      : {}),
  });
}

// Proof of a paid checkout, kept by handleStripeReturn so a publish from this browser right
// after paying (before an account exists) is still the owner's. /api/deploy-site re-checks it
// with Stripe (paid, this slug, recent); it never counts for an app site.
const CHECKOUT_PROOF_KEY = 'checkoutProof';

/** Remember the verified checkout session for `siteId`. Never throws. */
export function rememberCheckoutProof(siteId: string, sessionId: string): void {
  try {
    globalThis.localStorage?.setItem(CHECKOUT_PROOF_KEY, JSON.stringify({ siteId, sessionId }));
  } catch { /* private mode etc. */ }
}

/** The remembered checkout session id when it is for `siteId`, else null. Never throws. */
export function checkoutProofFor(siteId: string): string | null {
  try {
    const raw = globalThis.localStorage?.getItem(CHECKOUT_PROOF_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    return p && p.siteId === siteId && typeof p.sessionId === 'string' ? p.sessionId : null;
  } catch {
    return null;
  }
}

/** The message shown when /api/deploy-site refuses. */
export function deployErrorMessage(status: number, data: { error?: unknown } | null | undefined): string {
  if (status === 401) return 'Please sign in to your account to publish this site.';
  if (status === 403 && data?.error === 'checkout-not-valid') {
    return "We couldn't confirm the payment for this site. Your payment is safe; please contact support and we'll finish publishing.";
  }
  if (status === 403) return 'This site belongs to a different account. Sign in with the account that owns it to publish.';
  if (status === 429) return 'Too many publish attempts. Please wait a minute and try again.';
  if (status === 503) return 'Publishing is temporarily unavailable. Please try again in a minute.';
  const err = data && typeof data.error === 'string' ? data.error : 'Unknown error';
  return `Deployment failed: ${err}`;
}
