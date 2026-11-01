// The web export is served under /app and bundles with Metro as a single page. Those two settings must NOT exist in the
// native config: Expo passes experiments.baseUrl to every platform's bundle (it would change the iOS bundle's asset paths
// and router hrefs). So they are added only when the web build asks for them (scripts/build-web.sh sets EXPO_WEB_EXPORT=1).
module.exports = ({ config }) => {
  if (process.env.EXPO_WEB_EXPORT !== '1') return config;
  return {
    ...config,
    web: { ...(config.web || {}), output: 'single', bundler: 'metro' },
    experiments: { ...(config.experiments || {}), baseUrl: '/app' },
  };
};
