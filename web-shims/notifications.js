// Web stand-in for expo-notifications: scheduling and push are not part of the web app.
const noop = async () => {};
module.exports = new Proxy({ getAllScheduledNotificationsAsync: async () => [], getPermissionsAsync: async () => ({ status: 'denied', granted: false }), requestPermissionsAsync: async () => ({ status: 'denied', granted: false }) }, { get: (t, k) => (k in t ? t[k] : noop) });
