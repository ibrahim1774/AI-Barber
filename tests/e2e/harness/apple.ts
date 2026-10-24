// Fake App Store Server API behind the REAL lib/ios/appleVerify.ts makeVerifier: per-purchase
// subscription state (environment, transactions, upgrades, refunds, expiry, billing status) is
// served through `lookup` (Get Transaction Info), `statuses` (Get All Subscription Statuses) and
// `decode` (signed payload verification). Signed payloads are JSON strings tagged with their
// environment: decoding in the other environment fails like INVALID_ENVIRONMENT does.
import { VerifyFailure, makeVerifier, type AppleDecode, type AppleLookup, type AppleStatuses, type DecodedTransaction, type IosEnv } from '../../../lib/ios/appleVerify.js';

export const BUNDLE = 'com.ibrahim1774.aibarber';
export const P = 'com.ibrahim1774.aibarber.';
export const PRODUCTS = {
  websiteMonthly: `${P}hosting.monthly`,
  websiteYearly: `${P}hosting.yearly`,
  bookingsMonthly: `${P}bookings.monthly`,
  bookingsYearly: `${P}bookings.yearly`,
  storeMonthly: `${P}store.monthly`,
  storeYearly: `${P}store.yearly`,
} as const;

const MONTH = 30 * 86_400_000;
const YEAR = 365 * 86_400_000;
export const periodOf = (product: string) => (product.endsWith('.yearly') ? YEAR : MONTH);

export interface FakeTx {
  transactionId: string;
  productId: string;
  purchaseDate: number;
  expiresDate: number;
  revocationDate?: number;
  isUpgraded?: boolean;
  bundleId?: string;
}

export interface FakeSub {
  otid: string;
  env: IosEnv;
  txs: FakeTx[];
  /** Apple status override (3 billing retry, 4 grace...). Default: 5 revoked, 1 active, 2 expired. */
  status?: number;
}

export function fakeApple(clock: () => number) {
  const subs = new Map<string, FakeSub>();
  const byTx = new Map<string, string>();
  let n = 0;
  const state = { down: false, calls: 0, lookups: [] as string[] };

  const latest = (s: FakeSub) => [...s.txs].reverse().find((t) => !t.isUpgraded) ?? s.txs[s.txs.length - 1];
  const statusOf = (s: FakeSub) => {
    if (s.status != null) return s.status;
    const t = latest(s);
    if (t.revocationDate != null) return 5;
    return t.expiresDate > clock() ? 1 : 2;
  };
  const signTx = (env: IosEnv, txId: string) => JSON.stringify({ env, txId });

  const lookup: AppleLookup = async (env, transactionId) => {
    state.calls++;
    state.lookups.push(`${env}:${transactionId}`);
    if (state.down) throw new Error('apple down');
    const otid = byTx.get(transactionId);
    const s = otid ? subs.get(otid) : undefined;
    if (!s || s.env !== env) return { status: 404 };
    return { status: 200, signedTransactionInfo: signTx(env, transactionId) };
  };

  const decode: AppleDecode = async (env, signed) => {
    let p: { env: IosEnv; txId: string; forged?: boolean };
    try {
      p = JSON.parse(signed);
    } catch {
      throw new Error('bad signature');
    }
    if (p.forged) throw new Error('bad signature');
    if (p.env !== env) throw new VerifyFailure('not-found');
    const otid = byTx.get(p.txId);
    const s = otid ? subs.get(otid) : undefined;
    const t = s?.txs.find((x) => x.transactionId === p.txId);
    if (!s || !t) throw new Error('unknown transaction');
    const d: DecodedTransaction = {
      bundleId: t.bundleId ?? BUNDLE, productId: t.productId, originalTransactionId: s.otid, transactionId: t.transactionId,
      expiresDate: t.expiresDate, purchaseDate: t.purchaseDate, isUpgraded: t.isUpgraded === true,
      ...(t.revocationDate != null ? { revocationDate: t.revocationDate } : {}),
    };
    return d;
  };

  const statuses: AppleStatuses = async (env, transactionId) => {
    state.calls++;
    if (state.down) throw new Error('apple down');
    const otid = byTx.get(transactionId) ?? transactionId;
    const s = subs.get(otid);
    if (!s || s.env !== env) return { status: 404 };
    return { status: 200, items: [{ status: statusOf(s), originalTransactionId: s.otid, signedTransactionInfo: signTx(env, latest(s).transactionId) }] };
  };

  function addTx(s: FakeSub, productId: string, start: number, extra: Partial<FakeTx> = {}): FakeTx {
    const t: FakeTx = { transactionId: `${2000000000000000 + ++n}`, productId, purchaseDate: start, expiresDate: start + periodOf(productId), ...extra };
    s.txs.push(t);
    byTx.set(t.transactionId, s.otid);
    return t;
  }

  const api = {
    state,
    subs,
    verify: makeVerifier({ lookup, decode, statuses, bundleId: BUNDLE }),
    lookup, decode, statuses,
    /** A new subscription. Returns the transactionId the app would send. The otid is Apple's first transaction id. */
    buy(productId: string, opts: { env?: IosEnv; at?: number; otid?: string } = {}) {
      const at = opts.at ?? clock();
      const otid = opts.otid ?? `${1000000000000000 + ++n}`;
      const s: FakeSub = { otid, env: opts.env ?? 'Production', txs: [] };
      subs.set(otid, s);
      byTx.set(otid, otid);
      const t = addTx(s, productId, at, { transactionId: otid });
      byTx.set(t.transactionId, otid);
      return { otid, transactionId: otid };
    },
    /** Auto-renewal (same product unless a downgrade was scheduled). */
    renew(otid: string, opts: { productId?: string; at?: number } = {}) {
      const s = subs.get(otid)!;
      const prev = latest(s);
      const at = opts.at ?? prev.expiresDate;
      return addTx(s, opts.productId ?? prev.productId, at);
    },
    /** Immediate same-group upgrade: the replaced transaction is isUpgraded + revoked. */
    upgrade(otid: string, productId: string, at = clock()) {
      const s = subs.get(otid)!;
      const prev = latest(s);
      prev.isUpgraded = true;
      prev.revocationDate = at;
      return addTx(s, productId, at);
    },
    /** Refund / revoke the latest transaction. */
    refund(otid: string, at = clock()) {
      latest(subs.get(otid)!).revocationDate = at;
    },
    /** Let the current period run out now (no renewal). */
    lapse(otid: string, at = clock()) {
      latest(subs.get(otid)!).expiresDate = at - 1;
    },
    setStatus(otid: string, status: number | undefined) {
      subs.get(otid)!.status = status;
    },
    latest: (otid: string) => latest(subs.get(otid)!),
    /** A signed App Store Server Notification V2 payload (decodeNotification below reads it). */
    notification(type: string, otid: string, opts: { tx?: FakeTx; env?: IosEnv; bundleId?: string } = {}) {
      const s = subs.get(otid)!;
      const env = opts.env ?? s.env;
      const t = opts.tx ?? latest(s);
      return JSON.stringify({ notificationType: type, data: { environment: env, bundleId: opts.bundleId ?? BUNDLE, signedTransactionInfo: signTx(env, t.transactionId) } });
    },
    decodeNotification: async (p: string) => {
      const d = JSON.parse(p);
      if (d.forged) throw new Error('bad signature');
      return d;
    },
  };
  return api;
}

export type FakeApple = ReturnType<typeof fakeApple>;
