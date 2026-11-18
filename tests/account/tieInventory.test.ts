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

// Call sites versus checks, per file: the minimum number of `tie(` asks each file must contain (one per tie point in it), counted from the source.
const MIN_ASKS: Record<string, number> = { 'lib/ios/publishFlow.ts': 2, 'lib/ios/planFlow.ts': 2, 'lib/bookings/ownerFlow.ts': 1, 'lib/bookings/live.ts': 1, 'lib/ios/transfer.ts': 1 };
describe('every tie point has its ask, counted', () => {
  for (const [f, min] of Object.entries(MIN_ASKS)) {
    it(`${f}: at least ${min} ask(s) of tie(`, () => {
      const src = readFileSync(join(root, f), 'utf8');
      expect([...src.matchAll(/\btie\(/g)].length).toBeGreaterThanOrEqual(min);
    });
  }
  it('transfer.ts asks at BOTH writers (the unlinked link and the confirmed move)', () => {
    const src = readFileSync(join(root, 'lib/ios/transfer.ts'), 'utf8');
    expect([...src.matchAll(/tieRefusal\(caller, '/g)].map((m) => m[0]).length).toBe(2);
  });
});

describe('no other raw writer of ios_purchases.user_id or ab_shops.ios_otid', () => {
  // Repo implementations (the one place each column is written) and nothing else: raw supabase-js writes and PostgREST PATCH/POST strings.
  const REPO = new Set(['lib/ios/purchases.ts', 'lib/bookings/repo.ts']);
  const rel = (f: string) => f.slice(root.length + 1);
  const scan = (re: RegExp) => files.filter((f) => !REPO.has(rel(f)) && re.test(readFileSync(f, 'utf8'))).map(rel);
  it('supabase-js writes to ios_purchases', () => { expect(scan(/from\(['"]ios_purchases['"]\)\s*\.(update|upsert|insert|delete)\(/)).toEqual([]); });
  it('supabase-js writes of ios_otid', () => { expect(scan(/\.update\(\{[^}]*\bios_otid\b/)).toEqual([]); });
  it('PostgREST PATCH/POST/DELETE strings on ios_purchases or ab_shops', () => {
    expect(scan(/(ios_purchases|ab_shops)\?[^`'"]*[`'"]\s*,\s*\{[^}]*method:\s*['"](PATCH|POST|DELETE)['"]/)).toEqual([]);
  });
  it('an `ios_otid` or `user_id` key inside an insert/upsert payload of those tables', () => {
    expect(scan(/from\(['"](ios_purchases|ab_shops)['"]\)\s*\.(insert|upsert)\(\{[^}]*\b(ios_otid|user_id)\b/)).toEqual([]);
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
