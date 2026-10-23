// E2E stand-in for expo-secure-store: the "keychain" lives in the local stub (127.0.0.1:8787/__e2e/kv/*),
// so the harness can seed a signed-in Supabase session (POST /__e2e/signin) without typing into the
// secure password field, and the session survives app reloads like the real keychain does.
// Only the stub is ever contacted. Wired in by metro-preload.js; app source is untouched.
const BASE = 'http://127.0.0.1:8787/__e2e/kv/';
const url = (k) => BASE + encodeURIComponent(k);
exports.getItemAsync = async (k) => {
  try { const r = await fetch(url(k)); return r.status === 200 ? await r.text() : null; } catch { return null; }
};
exports.setItemAsync = async (k, v) => {
  try { await fetch(url(k), { method: 'PUT', headers: { 'Content-Type': 'text/plain' }, body: String(v) }); } catch {}
};
exports.deleteItemAsync = async (k) => {
  try { await fetch(url(k), { method: 'DELETE' }); } catch {}
};
exports.isAvailableAsync = async () => true;
