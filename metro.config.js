const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Web build only: native-only packages resolve to browser stand-ins in web-shims/.
// Other platforms (and the iOS app on its own branch) never see this map.
const WEB_SHIMS = {
  'expo-sqlite/kv-store': 'kv-store.js',
  'expo-secure-store': 'secure-store.js',
  'expo-superwall': 'superwall.js',
  'react-native-purchases': 'purchases.js',
  'react-native-appsflyer': 'appsflyer.js',
  'expo-tracking-transparency': 'tracking.js',
  'expo-notifications': 'notifications.js',
  'react-native-webview': 'webview.js',
  'react-native': 'react-native.js',
};
const upstream = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, name, platform) => {
  if (platform === 'web' && WEB_SHIMS[name]) {
    return { type: 'sourceFile', filePath: path.join(__dirname, 'web-shims', WEB_SHIMS[name]) };
  }
  return (upstream || context.resolveRequest)(context, name, platform);
};

module.exports = config;
