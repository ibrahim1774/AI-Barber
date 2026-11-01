// Web only: whether the signed-in owner has an active Stripe web plan (GET /api/web-app/me, the same answer the plan
// screen and the entitlements use). A web shop has no Apple purchase (ab_shops.ios_otid), so this is what "the
// plan is linked to the shop" means in the browser. web-shims/superwall.js feeds it; the phone app never touches it.
let active = false;
let settled = false;
let waiters: (() => void)[] = [];

export const isWebPlanActive = () => active;

export function setWebPlanActive(v: boolean): void {
  active = v;
  settled = true;
  const w = waiters; waiters = [];
  w.forEach((f) => f());
}

/** Resolves once /api/web-app/me has answered at least once (or after `ms`, so a slow answer never blocks a screen). */
export function webPlanReady(ms = 4000): Promise<void> {
  if (settled) return Promise.resolve();
  return new Promise((res) => {
    const t = setTimeout(res, ms);
    waiters.push(() => { clearTimeout(t); res(); });
  });
}
