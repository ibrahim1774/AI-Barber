// Web stand-in for expo-superwall: no paywall SDK in the browser; web payments come from Stripe later.
const React = require('react');
const state = { isConfigured: true };
module.exports = {
  SuperwallProvider: ({ children }) => children,
  usePlacement: () => ({ registerPlacement: async () => {}, state: { status: 'idle' } }),
  useSuperwall: (sel) => (typeof sel === 'function' ? sel(state) : state),
  useSuperwallEvents: () => {},
  useUser: () => ({ subscriptionStatus: { status: 'INACTIVE' }, setIntegrationAttributes: async () => {}, getCustomerInfo: async () => ({}), identify: async () => {}, signOut: async () => {} }),
};
