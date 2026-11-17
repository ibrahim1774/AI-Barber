// The tie-point inventory: every call that writes ios_purchases.user_id (setUserIfUnlinked, linkUserIfUnlinked, transferUser) or
// ab_shops.ios_otid (setShopOtid) in lib/ and api/, and the `deps.tie(` / `tie(` check that must sit in the same file. A new tie point
// added later fails this test until it is added here AND asks the check.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { liveTie } from '../../lib/account/mayTake.js';

const root = join(__dirname, '..', '..');
const walk = (d: string): string[] => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : []; });
const files = [...walk(join(root, 'lib')), ...walk(join(root, 'api'))];
const CALL = /\.(setUserIfUnlinked|linkUserIfUnlinked|setShopOtid|transferUser)\(/g;

// file -> [calls that write], and whether it must ask `tie` (definitions of the repo methods themselves are not call sites).
const EXPECTED: Record<string, { asks: string }> = {
  'lib/ios/publishFlow.ts': { asks: 'deps.tie(' },      // unlinked publish tie, Restore tie
  'lib/ios/planFlow.ts': { asks: 'deps.tie(' },         // plan check with a shop, and with no shop (the live deps only forward the repo methods)
  'lib/bookings/ownerFlow.ts': { asks: 'deps.tie(' },   // shop setup (shop link, then the account link)
  'lib/bookings/live.ts': { asks: 'tie(' },             // the verifier's own link (reached from ownerFlow's link)
  'lib/ios/transfer.ts': { asks: 'deps.tie(' },         // the unlinked link, and the confirmed move (transferUser)
};

describe('tie-point inventory', () => {
  it('every writer of ios_purchases.user_id and ab_shops.ios_otid is a known tie point that asks the check', () => {
    const found: Record<string, string[]> = {};
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      const hits = [...src.matchAll(CALL)].map((m) => m[1]);
      if (hits.length) found[f.slice(root.length + 1)] = hits;
    }
    // repo implementations (the definitions) are not tie points: lib/bookings/repo.ts and lib/ios/purchases.ts define them, and the wiring files only forward.
    const ignore = new Set(['lib/bookings/repo.ts', 'lib/ios/purchases.ts']);
    const callers = Object.fromEntries(Object.entries(found).filter(([f]) => !ignore.has(f)));
    expect(Object.keys(callers).sort()).toEqual(Object.keys(EXPECTED).sort());
    for (const [f, e] of Object.entries(EXPECTED)) {
      const src = readFileSync(join(root, f), 'utf8');
      expect(src.includes(e.asks), `${f} must ask ${e.asks}`).toBe(true);
    }
  });
});

describe('liveTie with the guard off', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
  it('allows and reads nothing (no fetch at all)', async () => {
    vi.stubEnv('ONE_SITE_GUARD', '');
    const fetchSpy = vi.fn(async () => { throw new Error('no network with the guard off'); });
    vi.stubGlobal('fetch', fetchSpy);
    expect(await liveTie('u', 'o', 'x')).toEqual({ action: 'allow' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
