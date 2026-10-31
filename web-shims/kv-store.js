// Web stand-in for expo-sqlite/kv-store: same async API on top of localStorage.
const ls = () => { try { return globalThis.localStorage; } catch { return null; } };
const mem = new Map();
// The app shares an origin (www.aibarber.org) with the marketing site, so every key is prefixed.
const P = 'abapp:';
const Storage = {
  async getItem(k) { const s = ls(); return s ? s.getItem(P + k) : (mem.get(k) ?? null); },
  async setItem(k, v) { const s = ls(); if (s) s.setItem(P + k, String(v)); else mem.set(k, String(v)); },
  async removeItem(k) { const s = ls(); if (s) s.removeItem(P + k); else mem.delete(k); },
  async getAllKeys() { const s = ls(); return s ? Object.keys(s).filter((k) => k.startsWith(P)).map((k) => k.slice(P.length)) : [...mem.keys()]; },
  async clear() { const s = ls(); if (s) Object.keys(s).filter((k) => k.startsWith(P)).forEach((k) => s.removeItem(k)); else mem.clear(); },
  getItemSync(k) { const s = ls(); return s ? s.getItem(P + k) : (mem.get(k) ?? null); },
  setItemSync(k, v) { const s = ls(); if (s) s.setItem(P + k, String(v)); else mem.set(k, String(v)); },
  removeItemSync(k) { const s = ls(); if (s) s.removeItem(P + k); else mem.delete(k); },
};
module.exports = Storage; module.exports.default = Storage;
module.exports.Storage = Storage;
