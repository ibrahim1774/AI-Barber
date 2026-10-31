// Web stand-in for expo-superwall. There is no paywall SDK in a browser: the subscription state comes from the
// server (GET /api/web-app/me, backed by Stripe) and "presenting a paywall" opens our own plan screen (/web-paywall).
// The app's own paywall/entitlement code runs unchanged on top of this.
const React = require('react');
const { router } = require('expo-router');
const { supabase } = require('../src/lib/supabase');

const BASE = process.env.EXPO_PUBLIC_API_BASE || 'https://www.aibarber.org';
const PRODUCT = { website: 'hosting', bookings: 'bookings', store: 'store' };
const ENTS = { website: ['hosting'], bookings: ['hosting', 'bookings'], store: ['hosting', 'bookings', 'store'] };

let state = { status: { status: 'INACTIVE' }, subs: [] };
const listeners = new Set();
const set = (s) => { state = s; listeners.forEach((l) => l()); };
const subscribe = (l) => { listeners.add(l); return () => listeners.delete(l); };

async function refresh() {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data && data.session && data.session.access_token;
    if (!token) return set({ status: { status: 'INACTIVE' }, subs: [] });
    const r = await fetch(BASE + '/api/web-app/me', { headers: { Authorization: 'Bearer ' + token } });
    if (!r.ok) return;
    const me = await r.json();
    if (!me.entitled || !ENTS[me.tier]) return set({ status: { status: 'INACTIVE' }, subs: [] });
    set({
      status: { status: 'ACTIVE', entitlements: ENTS[me.tier].map((id) => ({ id })) },
      subs: [{ productId: 'com.ibrahim1774.aibarber.' + PRODUCT[me.tier] + '.' + (me.interval === 'year' ? 'yearly' : 'monthly'), transactionId: 'web:' + me.subscriptionId, isActive: true, isRevoked: false, purchaseDate: new Date().toISOString() }],
    });
  } catch (e) { /* offline: keep the last state */ }
}

// Coming back from Stripe (?paid=1) the webhook may lag a moment: ask a few times.
function pollAfterPayment() {
  let n = 0;
  const t = setInterval(async () => { n++; await refresh(); if (state.status.status === 'ACTIVE' || n >= 15) clearInterval(t); }, 2000);
}
if (typeof window !== 'undefined') {
  window.addEventListener('focus', refresh);
  supabase.auth.onAuthStateChange(() => { refresh(); });
  refresh();
  if (/[?&]paid=1/.test(window.location.search)) pollAfterPayment();
}

const useStore = () => React.useSyncExternalStore(subscribe, () => state);

function SuperwallProvider({ children }) { return children; }

// The placement callbacks of the paywall that is showing; the plan screen reports its closing through dismissWebPaywall.
let showing = null;
function dismissWebPaywall() {
  const c = showing; showing = null;
  c && c.onDismiss && c.onDismiss({ name: 'web', closeReason: 'manualClose' }, { type: 'declined' });
}

function usePlacement(cbs) {
  const registerPlacement = React.useCallback(async (p) => {
    try { window.__webPaywall = { placement: p.placement, params: p.params || null }; } catch (e) {}
    showing = cbs || null;
    cbs && cbs.onPresent && cbs.onPresent({ name: 'web' });
    router.push('/web-paywall');
    // The plan screen either leaves for Stripe (the page unloads; the paid state is re-read on return) or is closed (dismissWebPaywall).
  }, [cbs]);
  return { registerPlacement, state: { status: 'idle' } };
}

function useSuperwall(sel) {
  const s = { isConfigured: true, configurationError: null };
  return typeof sel === 'function' ? sel(s) : s;
}

function useUser() {
  const s = useStore();
  return React.useMemo(() => ({
    subscriptionStatus: s.status,
    setIntegrationAttributes: async () => {},
    getCustomerInfo: async () => ({ subscriptions: state.subs }),
    identify: async () => {},
    signOut: async () => {},
  }), [s]);
}

module.exports = { SuperwallProvider, usePlacement, useSuperwall, useSuperwallEvents: () => {}, useUser, __refreshWebSubscription: refresh, __dismissWebPaywall: dismissWebPaywall };
