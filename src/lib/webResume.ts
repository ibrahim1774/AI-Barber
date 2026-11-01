// Web only: remembering "I was publishing" across the trip to Stripe Checkout (the page unloads, so nothing in memory
// survives). The flag is one-shot, kept in sessionStorage AND localStorage (either may be blocked), and ignored after 2 h.
import type { PlanHint } from '@/lib/publishRequest';
import { isPlanHint } from '@/lib/publishRequest';

export const RESUME_KEY = 'ab.resumePublish';
export const RESUME_MAX_AGE_MS = 2 * 60 * 60 * 1000;

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const stores = (): Store[] => {
  const out: Store[] = [];
  for (const name of ['sessionStorage', 'localStorage'] as const) {
    try { const s = (globalThis as unknown as Record<string, Store | undefined>)[name]; if (s) out.push(s); } catch { /* blocked */ }
  }
  return out;
};

export function setResume(planHint: PlanHint | undefined, now = Date.now()): void {
  const v = JSON.stringify({ planHint: planHint ?? null, at: now });
  for (const s of stores()) { try { s.setItem(RESUME_KEY, v); } catch { /* full / blocked */ } }
}

/** The saved request, or null (none, unreadable, or older than 2 h; an expired one is removed). Does not clear a valid one. */
export function readResume(now = Date.now()): { planHint?: PlanHint } | null {
  for (const s of stores()) {
    try {
      const raw = s.getItem(RESUME_KEY);
      if (!raw) continue;
      const v = JSON.parse(raw) as { planHint?: unknown; at?: unknown };
      if (typeof v.at !== 'number' || now - v.at > RESUME_MAX_AGE_MS || v.at > now + 60_000) { clearResume(); return null; }
      return isPlanHint(v.planHint) ? { planHint: v.planHint } : {};
    } catch { /* try the next store */ }
  }
  return null;
}

export function clearResume(): void {
  for (const s of stores()) { try { s.removeItem(RESUME_KEY); } catch { /* ignore */ } }
}

/** One-shot: the saved request, cleared in the same step (so a refresh or a second tab cannot publish twice). */
export function takeResume(now = Date.now()): { planHint?: PlanHint } | null {
  const r = readResume(now);
  if (r) clearResume();
  return r;
}

/** What Stripe's return URL says: `?paid=1` paid, `?paid=0` cancelled. */
export function paidParam(search: string): 'paid' | 'cancelled' | null {
  const m = /[?&]paid=([01])(?:&|$)/.exec(search);
  return m ? (m[1] === '1' ? 'paid' : 'cancelled') : null;
}

/** Remove ?paid from the address so a refresh does not run the return again. */
export function stripPaidParam(): void {
  try {
    const u = new URL(window.location.href);
    if (!u.searchParams.has('paid')) return;
    u.searchParams.delete('paid');
    window.history.replaceState(window.history.state, '', u.pathname + (u.search || '') + u.hash);
  } catch { /* ignore */ }
}
