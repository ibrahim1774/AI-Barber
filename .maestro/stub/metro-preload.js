// node --require this file before `expo start`: wraps expo/metro-config's getDefaultConfig so
// expo-superwall resolves to the E2E mock. Leaves metro.config.js and src/ untouched.
const Module = require('module');
const path = require('path');
const orig = Module._load;
Module._load = function (request, parent, isMain) {
  const mod = orig.apply(this, arguments);
  if (request === 'expo/metro-config' && mod && !mod.__e2e) {
    const wrapped = Object.assign({}, mod, {
      __e2e: true,
      getDefaultConfig: (...args) => {
        const cfg = mod.getDefaultConfig(...args);
        const prev = cfg.resolver.resolveRequest;
        cfg.resolver.resolveRequest = (ctx, name, plat) => {
          if (name === 'expo-superwall') return { type: 'sourceFile', filePath: path.join(__dirname, 'superwall-e2e.js') };
          if (name === 'expo-secure-store') return { type: 'sourceFile', filePath: path.join(__dirname, 'secure-store-e2e.js') };
          return prev ? prev(ctx, name, plat) : ctx.resolveRequest(ctx, name, plat);
        };
        cfg.watchFolders = [...(cfg.watchFolders || []), __dirname];
        return cfg;
      },
    });
    return wrapped;
  }
  return mod;
};
