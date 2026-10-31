// Web stand-in for expo-sqlite/kv-store: same async API on top of localStorage.
const ls = () => { try { return globalThis.localStorage; } catch { return null; } };
const mem = new Map();
const Storage = {
  async getItem(k) { const s = ls(); return s ? s.getItem(k) : (mem.get(k) ?? null); },
  async setItem(k, v) { const s = ls(); if (s) s.setItem(k, String(v)); else mem.set(k, String(v)); },
  async removeItem(k) { const s = ls(); if (s) s.removeItem(k); else mem.delete(k); },
  async getAllKeys() { const s = ls(); return s ? Object.keys(s) : [...mem.keys()]; },
  async clear() { const s = ls(); if (s) s.clear(); else mem.clear(); },
  getItemSync(k) { const s = ls(); return s ? s.getItem(k) : (mem.get(k) ?? null); },
  setItemSync(k, v) { const s = ls(); if (s) s.setItem(k, String(v)); else mem.set(k, String(v)); },
  removeItemSync(k) { const s = ls(); if (s) s.removeItem(k); else mem.delete(k); },
};
module.exports = Storage; module.exports.default = Storage;
module.exports.Storage = Storage;
