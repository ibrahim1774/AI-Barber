import type { StripeStatus } from '@/lib/setup/ownerApi';

/** Web only: how often, and for how long, the Get paid card re-reads the Stripe status after the owner opened Stripe. */
export const STRIPE_POLL_MS = 5000;
export const STRIPE_POLL_WINDOW_MS = 3 * 60 * 1000;

export const STRIPE_VERIFYING = 'Stripe is verifying your details, this can take a couple of minutes. This page updates by itself.';
export const STRIPE_CARDS_ON = 'Cards are on. Customers can pay by card when they book.';
export const STRIPE_NEEDS_DETAILS = 'Stripe still needs a few details before cards can be used. Finish setup to turn them on.';

/** 'on' = charges enabled; 'verifying' = details sent, Stripe still checking; 'needs' = connected but unfinished; 'none' = no account. */
export type CardState = 'on' | 'verifying' | 'needs' | 'none';

export function cardState(s: Pick<StripeStatus, 'connected' | 'chargesEnabled' | 'detailsSubmitted'>): CardState {
  if (s.chargesEnabled) return 'on';
  if (s.detailsSubmitted) return 'verifying';
  if (s.connected) return 'needs';
  return 'none';
}

/** The ?stripe= value Stripe's return / refresh link puts on the web app's address, or null. */
export function stripeReturnParam(v: unknown): 'return' | 'refresh' | null {
  const x = Array.isArray(v) ? v[0] : v;
  return x === 'return' || x === 'refresh' ? x : null;
}

/** What the owner sees at the top of Get paid after coming back from Stripe (web). */
export function stripeReturnBanner(kind: 'return' | 'refresh', state: CardState): { text: string; tone: 'ok' | 'warn' } {
  if (state === 'on') return { text: 'Stripe is done. ' + STRIPE_CARDS_ON, tone: 'ok' };
  if (state === 'verifying') return { text: STRIPE_VERIFYING, tone: 'warn' };
  if (kind === 'refresh') return { text: 'That Stripe link expired before you finished. Tap Finish setup with Stripe to get a fresh one.', tone: 'warn' };
  return { text: 'Stripe setup is not finished yet. Tap Finish setup with Stripe to continue where you stopped.', tone: 'warn' };
}

/** True while the 5 s polling window that starts when Stripe is opened is still open. */
export const pollingOpen = (until: number, now: number = Date.now()) => now < until;
