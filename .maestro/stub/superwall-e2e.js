// E2E stand-in for expo-superwall. NO network, NO StoreKit, NO real purchase.
// The paywall is an Alert with "E2E: buy ..." / "E2E: close" so Maestro can drive it.
// The REAL Superwall paywall UI and its copy are NOT exercised.
const React = require('react');
const { Alert } = require('react-native');

// d is encoded into the transaction id (20000000<d><nnn>) so the stub server can tell the tier.
const PRODUCT = {
  publish: { id: 'com.ibrahim1774.aibarber.hosting.yearly', ent: ['hosting'], d: 1 },
  bookings_upgrade: { id: 'com.ibrahim1774.aibarber.bookings.yearly', ent: ['hosting', 'bookings'], d: 2 },
  store_upgrade: { id: 'com.ibrahim1774.aibarber.store.yearly', ent: ['hosting', 'bookings', 'store'], d: 3 },
  custom_domain: { id: 'com.ibrahim1774.aibarber.domain.yearly', ent: [], d: 4 },
};

const st = { subs: [], status: 'INACTIVE', ents: [], n: 0 };
const listeners = new Set();
const emit = () => listeners.forEach((l) => l());
const snapshot = () => ({ status: st.status, entitlements: st.ents.map((id) => ({ id })) });
let cached = snapshot();
const refresh = () => { cached = snapshot(); emit(); };

function buy(placement) {
  const p = PRODUCT[placement] || PRODUCT.publish;
  st.n += 1;
  st.subs.push({ transactionId: `20000000${p.d}${String(100 + st.n)}`, productId: p.id, purchaseDate: new Date().toISOString(), isActive: true, isRevoked: false, expirationDate: new Date(Date.now() + 365 * 864e5).toISOString() });
  for (const e of p.ent) if (!st.ents.includes(e)) st.ents.push(e);
  if (p.ent.length) st.status = 'ACTIVE';
  refresh();
  push();
  return p;
}
global.__E2E_SW = st; // debugging
// The subscription state lives in the stub (like the real Superwall's does across launches): load it at start,
// write it back after a purchase. Only 127.0.0.1:8787 is contacted.
const SW = 'http://127.0.0.1:8787/__e2e/sw';
const pull = () => fetch(SW).then((r) => r.json()).then((s) => { st.status = s.status; st.ents = s.ents; st.subs = s.subs; st.n = s.n; refresh(); }).catch(() => {});
const push = () => fetch(SW, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: st.status, ents: st.ents, subs: st.subs, n: st.n }) }).catch(() => {});
pull();

function useSub() {
  return React.useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => cached);
}

const getCustomerInfo = async () => ({ userId: '', subscriptions: st.subs.slice(), nonSubscriptions: [], entitlements: [] });
const setIntegrationAttributes = async () => {};

exports.SuperwallProvider = ({ children }) => children;
exports.useUser = () => ({ subscriptionStatus: useSub(), getCustomerInfo, setIntegrationAttributes });
exports.useSuperwallEvents = () => {};
exports.useSuperwall = (selector) => {
  const state = {
    isConfigured: true, configurationError: null,
    restorePurchases: async () => {
      if (st.subs.length) return { result: 'restored' };
      Alert.alert('No subscription found', 'We couldn’t find an active Prime Barber subscription for this Apple ID. (E2E mock)', [{ text: 'OK' }]);
      return { result: 'failed' };
    },
  };
  return selector ? selector(state) : state;
};
exports.usePlacement = (cb = {}) => ({
  registerPlacement: ({ placement, feature }) => new Promise((resolve) => {
    const p = PRODUCT[placement] || PRODUCT.publish;
    // Already entitled: Superwall skips the paywall and runs the feature.
    const owned = placement === 'publish' ? st.ents.includes('hosting') : placement === 'custom_domain' ? st.subs.some((s) => s.productId === p.id) : st.ents.includes(placement === 'bookings_upgrade' ? 'bookings' : 'store');
    if (owned) { feature && feature(); resolve(); return; }
    cb.onPresent && cb.onPresent({ name: `e2e-${placement}` });
    Alert.alert(`E2E MOCK PAYWALL: ${placement}`, `Simulated purchase of ${p.id}. No real money, no StoreKit.`, [
      { text: `E2E: buy ${placement}`, onPress: () => { buy(placement); cb.onDismiss && cb.onDismiss({ name: `e2e-${placement}` }, { type: 'purchased' }); feature && feature(); resolve(); } },
      { text: 'E2E: close', style: 'cancel', onPress: () => { cb.onDismiss && cb.onDismiss({ name: `e2e-${placement}` }, { type: 'declined' }); resolve(); } },
    ], { cancelable: false });
  }),
});
