// Web stand-in for expo-secure-store (browser has no keychain; localStorage under a prefix).
const P = 'ss:';
const ls = () => { try { return globalThis.localStorage; } catch { return null; } };
module.exports = {
  async getItemAsync(k) { return ls()?.getItem(P + k) ?? null; },
  async setItemAsync(k, v) { ls()?.setItem(P + k, v); },
  async deleteItemAsync(k) { ls()?.removeItem(P + k); },
};
