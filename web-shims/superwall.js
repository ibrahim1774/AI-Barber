// Web stand-in for expo-superwall. There is no paywall SDK in a browser: the subscription state comes from the
// server (GET /api/web-app/me, backed by Stripe) and "presenting a paywall" opens our own plan screen (/web-paywall).
// The app's own paywall/entitlement code runs unchanged on top of this.
const React = require('react');
const { router } = require('expo-router');
const { supabase } = require('../src/lib/supabase');
const { setWebPlanActive, setWebPlanCancellation, markWebPlanSettled, useWebPlanCheckFailed } = require('../src/lib/webPlan');
const { Text, Pressable, View } = require('react-native');

const BASE = process.env.EXPO_PUBLIC_API_BASE || 'https://www.aibarber.org';
const PRODUCT = { website: 'hosting', bookings: 'bookings', store: 'store' };
const ENTS = { website: ['hosting'], bookings: ['hosting', 'bookings'], store: ['hosting', 'bookings', 'store'] };

// UNKNOWN until /me answers: the app shows neither the paywall nor locked tabs on a guess.
let state = { status: { status: 'UNKNOWN' }, subs: [] };
const listeners = new Set();
const set = (s) => { state = s; listeners.forEach((l) => l()); };
const subscribe = (l) => { listeners.add(l); return () => listeners.delete(l); };

// Each call gets a number; only the newest call may apply its answer (a /me started for a previous account must not
// land after sign-out / sign-in).
let seq = 0;
let retryTimer = null;
let retryN = 0;
const RETRY_MS = [2000, 5000, 15000, 30000];
function scheduleRetry() {
  if (retryTimer) return;
  const wait = RETRY_MS[Math.min(retryN, RETRY_MS.length - 1)]; retryN++;
  retryTimer = setTimeout(() => { retryTimer = null; refresh(); }, wait);
}
async function refresh() {
  const mine = ++seq;
  try {
    const { data } = await supabase.auth.getSession();
    if (mine !== seq) return;
    const token = data && data.session && data.session.access_token;
    if (!token) { retryN = 0; setWebPlanActive(false); return set({ status: { status: 'INACTIVE' }, subs: [] }); }
    const r = await fetch(BASE + '/api/web-app/me', { headers: { Authorization: 'Bearer ' + token } });
    if (mine !== seq) return;
    if (!r.ok) { markWebPlanSettled({ failed: true }); scheduleRetry(); return; } // stay as we were (UNKNOWN at first)
    const me = await r.json();
    if (mine !== seq) return;
    retryN = 0;
    setWebPlanActive(!!(me.entitled && ENTS[me.tier]));
    setWebPlanCancellation(me.entitled && me.cancelAtPeriodEnd ? me.currentPeriodEnd : null);
    if (!me.entitled || !ENTS[me.tier]) return set({ status: { status: 'INACTIVE' }, subs: [] });
    set({
      status: { status: 'ACTIVE', entitlements: ENTS[me.tier].map((id) => ({ id })) },
      subs: [{ productId: 'com.ibrahim1774.aibarber.' + PRODUCT[me.tier] + '.' + (me.interval === 'year' ? 'yearly' : 'monthly'), transactionId: 'web:' + me.subscriptionId, isActive: true, isRevoked: false, purchaseDate: new Date().toISOString() }],
    });
  } catch (e) { if (mine === seq) { markWebPlanSettled({ failed: true }); scheduleRetry(); } } // offline: keep the last state, retry with backoff
}

// Coming back from Stripe (?paid=1) the webhook may lag a moment: ask a few times.
function pollAfterPayment() {
  let n = 0;
  const t = setInterval(async () => { n++; await refresh(); if (state.status.status === 'ACTIVE' || n >= 30) clearInterval(t); }, 2000);
}
if (typeof window !== 'undefined') {
  window.addEventListener('focus', refresh);
  supabase.auth.onAuthStateChange(() => { refresh(); });
  refresh();
  if (/[?&]paid=1/.test(window.location.search)) pollAfterPayment();
}

const useStore = () => React.useSyncExternalStore(subscribe, () => state);

// A neutral note while the plan check keeps failing (the app keeps its last known state; it retries by itself).
function PlanCheckNotice() {
  const failed = useWebPlanCheckFailed();
  if (!failed) return null;
  return React.createElement(View, { accessibilityRole: 'alert', style: { position: 'fixed', left: 12, right: 12, bottom: 12, zIndex: 50, padding: 12, borderRadius: 12, backgroundColor: '#1c1c1c', borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 } },
    React.createElement(Text, { style: { color: '#fff', fontSize: 13, flex: 1 } }, "Couldn't check your plan. Retrying…"),
    React.createElement(Pressable, { accessibilityRole: 'button', onPress: () => refresh() }, React.createElement(Text, { style: { color: '#fff', fontSize: 13, fontWeight: '600' } }, 'Try now')));
}

function SuperwallProvider({ children }) { return React.createElement(React.Fragment, null, children, React.createElement(PlanCheckNotice)); }

// The placement callbacks of the paywall that is showing; the plan screen reports its closing through dismissWebPaywall.
let showing = null;
function dismissWebPaywall() {
  const c = showing; showing = null;
  c && c.onDismiss && c.onDismiss({ name: 'web', closeReason: 'manualClose' }, { type: 'declined' });
}

function usePlacement(cbs) {
  const registerPlacement = React.useCallback(async (p) => {
    try { window.__webPaywall = { placement: p.placement, params: p.params || null }; } catch (e) {}
    // No web checkout for custom domains yet (the plan screen would sell the wrong product).
    if (p.placement === 'custom_domain') {
      try { window.alert('Custom domains are coming to the web app.'); } catch (e) {}
      cbs && cbs.onDismiss && cbs.onDismiss({ name: 'web', closeReason: 'manualClose' }, { type: 'declined' });
      return;
    }
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

module.exports = { __state: () => state, SuperwallProvider, usePlacement, useSuperwall, useSuperwallEvents: () => {}, useUser, __refreshWebSubscription: refresh, __dismissWebPaywall: dismissWebPaywall };
