// Web only: whether the signed-in owner has an active Stripe web plan (GET /api/web-app/me, the same answer the plan
// screen and the entitlements use). A web shop has no Apple purchase (ab_shops.ios_otid), so this is what "the
// plan is linked to the shop" means in the browser. web-shims/superwall.js feeds it; the phone app never touches it
// (nothing there ever calls the setters, so the hooks below stay at their initial values).
import { useSyncExternalStore } from 'react';

let active = false;
let cancelDate: string | null = null;
let settled = false;
let failed = false;
let waiters: (() => void)[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

export const isWebPlanActive = () => active;
/** True while the last plan check failed (no answer, 401/5xx): the UI shows a neutral "couldn't check your plan" note. */
export const webPlanCheckFailed = () => failed;

function settle(): void {
  settled = true;
  const w = waiters; waiters = [];
  w.forEach((f) => f());
}

/** A good /me answer: the plan is active or not. */
export function setWebPlanActive(v: boolean): void {
  const changed = active !== v || failed;
  active = v;
  if (!v) setWebPlanCancellation(null);
  failed = false;
  settle();
  if (changed) emit();
}

/** /me did not answer (error, offline, signed out): screens must not wait for it again, and `active` is left as it was. */
export function markWebPlanSettled(opts?: { failed?: boolean }): void {
  const f = !!opts?.failed;
  const changed = failed !== f;
  failed = f;
  settle();
  if (changed) emit();
}

/** Resolves once /api/web-app/me has answered (or failed) at least once, or after `ms`, so a slow answer never blocks a screen. */
export function webPlanReady(ms = 4000): Promise<void> {
  if (settled) return Promise.resolve();
  return new Promise((res) => {
    const t = setTimeout(res, ms);
    waiters.push(() => { clearTimeout(t); res(); });
  });
}

/** Re-renders when the web plan turns on/off. Always false on the phone. */
export const useWebPlanActive = (): boolean => useSyncExternalStore(subscribe, isWebPlanActive, () => false);
export const useWebPlanCheckFailed = (): boolean => useSyncExternalStore(subscribe, webPlanCheckFailed, () => false);

/** Test hook. */
export function __resetWebPlan(): void { active = false; cancelDate = null; settled = false; failed = false; waiters = []; listeners.clear(); }

/** Web billing display only; never used to grant access. */
export function setWebPlanCancellation(value: string | null): void {
  const next = value && Number.isFinite(Date.parse(value)) ? value : null;
  if (cancelDate !== next) { cancelDate = next; emit(); }
}
export const useWebPlanCancellation = (): string | null => useSyncExternalStore(subscribe, () => cancelDate, () => null);
