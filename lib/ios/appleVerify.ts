import fs from 'node:fs';
import path from 'node:path';
import { IOS_PRODUCT_IDS } from './tiers.js';
import { AppStoreServerAPIClient, APIException, SignedDataVerifier, VerificationException, VerificationStatus, Environment } from '@apple/app-store-server-library';

export type IosEnv = 'Production' | 'Sandbox';

export interface VerifiedTx {
  originalTransactionId: string;
  transactionId: string;
  /** The LATEST transaction of the purchase per Apple's status check (the proof JWS must be this one). */
  latestTransactionId?: string;
  productId: string;
  environment: IosEnv;
  /** From the purchase's LATEST transaction (Get All Subscription Statuses), not the id the app sent. */
  expiresAt: number | null;
  revoked: boolean;
  /** Apple subscription status: 1 Active, 2 Expired, 3 Billing retry, 4 Billing grace period, 5 Revoked. */
  status?: number;
  /**
   * Purchase date of the LATEST transaction, whose product `productId` is (Phase 4). Orders
   * product writes: ios_purchases.product_id never moves backwards (purchases.ts).
   */
  productPurchasedAt?: number | null;
  /**
   * Only with makeVerifier({ includeAccount: true }) (the domain endpoints): the
   * originalTransactionIds of every auto-renewable subscription of the same Apple account in
   * this app, across all subscription groups (Get All Subscription Statuses). Proves two
   * purchases were made by the same purchaser.
   */
  accountOriginalTransactionIds?: string[];
  /**
   * Only with makeVerifier({ includeRenewal: true }) (the domain endpoints): Apple's CURRENT
   * renewal status for this subscription (signedRenewalInfo.autoRenewStatus === 1). null when
   * Apple sent no renewal info or it could not be verified: callers treat that as "not renewing".
   */
  autoRenew?: boolean | null;
}

export type VerifyError = 'not-found' | 'bad-bundle' | 'bad-product' | 'apple-unavailable';

export class VerifyFailure extends Error {
  constructor(public code: VerifyError) {
    super(code);
    this.name = 'VerifyFailure';
  }
}

// The six products (Website, Bookings, Store × monthly, yearly) live in tiers.ts.
export { IOS_PRODUCT_IDS };

// Lives in txStatus.ts (no Apple SDK import) so purchases.ts can use it
// without pulling the App Store library into every function that reads rows.
export { isActive } from './txStatus.js';

export interface AppleLookup {
  (env: IosEnv, transactionId: string): Promise<{ status: number; signedTransactionInfo?: string }>;
}
export interface DecodedTransaction {
  bundleId: string; productId: string; originalTransactionId: string; transactionId: string;
  expiresDate?: number; revocationDate?: number; purchaseDate?: number;
  /** True on the transaction a same-group upgrade replaced (it is not the current product). */
  isUpgraded?: boolean;
  /** When Apple signed this JWS (ms). Used by the transfer proof (must be fresh). */
  signedDate?: number;
  /** 'Production' | 'Sandbox' as Apple wrote it into the signed payload. */
  environment?: string;
}
export interface AppleDecode {
  (env: IosEnv, signed: string): Promise<DecodedTransaction>;
}

/** The fields we use from Apple's decoded JWSTransaction (both default decoders). */
export function toDecodedTransaction(p: {
  bundleId?: string; productId?: string; originalTransactionId?: string; transactionId?: string;
  expiresDate?: number; revocationDate?: number; purchaseDate?: number; isUpgraded?: boolean;
  signedDate?: number; environment?: string;
}): DecodedTransaction {
  return {
    bundleId: p.bundleId as string, productId: p.productId as string,
    originalTransactionId: p.originalTransactionId as string, transactionId: p.transactionId as string,
    expiresDate: p.expiresDate, revocationDate: p.revocationDate, purchaseDate: p.purchaseDate,
    isUpgraded: p.isUpgraded === true,
    signedDate: p.signedDate, environment: p.environment == null ? undefined : String(p.environment),
  };
}

/** One lastTransactions entry from Get All Subscription Statuses (flattened across subscription groups). */
export interface AppleStatusItem {
  status?: number;
  originalTransactionId?: string;
  signedTransactionInfo?: string;
  signedRenewalInfo?: string;
}

/** Verifies and decodes a signedRenewalInfo (the fields we use). */
export interface AppleDecodeRenewal {
  (env: IosEnv, signed: string): Promise<{ autoRenewStatus?: number }>;
}
export interface AppleStatuses {
  (env: IosEnv, transactionId: string): Promise<{ status: number; items?: AppleStatusItem[] }>;
}

const ENVS: IosEnv[] = ['Production', 'Sandbox'];

function qaActiveOtids(): Set<string> {
  return new Set((process.env.IOS_QA_ACTIVE_OTIDS || '').split(',').map((x) => x.trim()).filter(Boolean));
}

const unavailable = () => new VerifyFailure('apple-unavailable');

export interface VerifierOptions {
  /**
   * Products this verifier accepts; anything else is bad-product. Default: the six site
   * products (IOS_PRODUCT_IDS). Only the domain endpoints pass [DOMAIN_PRODUCT_ID], so the
   * domain subscription can never satisfy a website / bookings / store gate.
   */
  products?: readonly string[];
  /** Return accountOriginalTransactionIds (see VerifiedTx). Default false. */
  includeAccount?: boolean;
  /** Return autoRenew from the latest signedRenewalInfo (see VerifiedTx). Default false. */
  includeRenewal?: boolean;
}

export function makeVerifier(deps: { lookup: AppleLookup; decode: AppleDecode; statuses: AppleStatuses; bundleId: string; decodeRenewal?: AppleDecodeRenewal } & VerifierOptions) {
  const products = deps.products ?? IOS_PRODUCT_IDS;
  return async function verify(transactionId: string): Promise<VerifiedTx> {
    for (const env of ENVS) {
      let res: { status: number; signedTransactionInfo?: string };
      try {
        res = await deps.lookup(env, transactionId);
      } catch {
        throw new VerifyFailure('apple-unavailable');
      }
      if (res.status === 401 || res.status === 404) continue; // not in this environment
      if (res.status !== 200 || !res.signedTransactionInfo) throw new VerifyFailure('apple-unavailable');

      let d: Awaited<ReturnType<AppleDecode>>;
      try {
        d = await deps.decode(env, res.signedTransactionInfo);
      } catch (e) {
        if (e instanceof VerifyFailure) {
          if (e.code === 'not-found') continue; // not valid in this environment
          throw e;
        }
        throw new VerifyFailure('apple-unavailable');
      }
      if (d.bundleId !== deps.bundleId) throw new VerifyFailure('bad-bundle');
      if (!products.includes(d.productId)) throw new VerifyFailure('bad-product');

      // The transaction above proves ownership/bundle/product. Whether the
      // subscription is live comes from its LATEST state: the id the app sent
      // may be the first period's, long expired, after many renewals. Same
      // environment that answered; any failure is apple-unavailable (503).
      let st: Awaited<ReturnType<AppleStatuses>>;
      try {
        st = await deps.statuses(env, d.originalTransactionId);
      } catch {
        throw unavailable();
      }
      if (st.status !== 200) throw unavailable();
      const item = (st.items || []).find((i) => i.originalTransactionId === d.originalTransactionId);
      if (!item || typeof item.status !== 'number' || !item.signedTransactionInfo) throw unavailable();
      let latest: Awaited<ReturnType<AppleDecode>>;
      try {
        latest = await deps.decode(env, item.signedTransactionInfo);
      } catch {
        throw unavailable(); // Apple-fetched payload: decode failure = misconfiguration, not a forgery
      }
      if (latest.originalTransactionId !== d.originalTransactionId) throw unavailable();
      // Upgrades and downgrades stay in the one subscription group (same originalTransactionId),
      // so the latest transaction carries the CURRENT product. It must be one of ours too.
      if (!products.includes(latest.productId)) throw new VerifyFailure('bad-product');

      const out: VerifiedTx = {
        originalTransactionId: d.originalTransactionId,
        transactionId: d.transactionId,
        latestTransactionId: latest.transactionId,
        productId: latest.productId,
        environment: env,
        expiresAt: latest.expiresDate ?? null,
        revoked: latest.revocationDate != null || item.status === 5,
        status: item.status,
        productPurchasedAt: latest.purchaseDate ?? null,
      };
      // QA only: a Sandbox subscription renews every few minutes and then expires, which makes long manual tests
      // impossible. Listed Sandbox purchases (env IOS_QA_ACTIVE_OTIDS, comma separated, default empty) stay active
      // unless Apple revoked them. Production purchases and unlisted ids are never touched.
      if (env === 'Sandbox' && !out.revoked && qaActiveOtids().has(out.originalTransactionId)) {
        out.status = 1;
        out.expiresAt = Math.max(out.expiresAt ?? 0, Date.now() + 24 * 60 * 60 * 1000);
      }
      if (deps.includeRenewal) {
        let auto: boolean | null = null;
        if (item.signedRenewalInfo && deps.decodeRenewal) {
          try {
            const r = await deps.decodeRenewal(env, item.signedRenewalInfo);
            auto = typeof r.autoRenewStatus === 'number' ? r.autoRenewStatus === 1 : null;
          } catch {
            auto = null; // unknown: never read as "renewing"
          }
        }
        out.autoRenew = auto;
      }
      if (deps.includeAccount) {
        out.accountOriginalTransactionIds = [...new Set((st.items || [])
          .map((i) => i.originalTransactionId).filter((o): o is string => typeof o === 'string' && o.length > 0))];
      }
      return out;
    }
    throw new VerifyFailure('not-found');
  };
}

const CERT_FILES = ['AppleRootCA-G3.cer', 'AppleRootCA-G2.cer', 'AppleIncRootCertificate.cer'];

function loadRootCerts(): Buffer[] {
  // Requires vercel.json includeFiles for lib/ios/certs/** on functions using this.
  return CERT_FILES.map((f) => fs.readFileSync(path.join(process.cwd(), 'lib/ios/certs', f)));
}

const apiEnvFor = { Production: Environment.PRODUCTION, Sandbox: Environment.SANDBOX } as const;
const signedDataVerifiers: Partial<Record<IosEnv, SignedDataVerifier>> = {};

/** Shared (cached) SignedDataVerifier per environment: Apple root certs + APPLE_BUNDLE_ID / APPLE_APP_ID. */
export function signedDataVerifierFor(env: IosEnv): SignedDataVerifier {
  const bundleId = process.env.APPLE_BUNDLE_ID;
  if (!bundleId) throw new VerifyFailure('apple-unavailable');
  const appAppleIdRaw = Number(process.env.APPLE_APP_ID);
  const appAppleId = Number.isFinite(appAppleIdRaw) && appAppleIdRaw > 0 ? appAppleIdRaw : undefined;
  return (signedDataVerifiers[env] ??= new SignedDataVerifier(
    loadRootCerts(), true, apiEnvFor[env], bundleId, env === 'Production' ? appAppleId : undefined));
}

/**
 * defaultVerifier(), built on first use: it throws when the Apple env vars are
 * missing, and that must surface as a rejected verify (mapped by the caller),
 * not a crash at wiring time.
 */
export function lazyDefaultVerifier(opts?: VerifierOptions): (transactionId: string) => Promise<VerifiedTx> {
  let verifier: ((id: string) => Promise<VerifiedTx>) | undefined;
  return (id) => {
    try {
      verifier ??= defaultVerifier(opts);
    } catch (e) {
      return Promise.reject(e);
    }
    return verifier(id);
  };
}

/** `opts` default: the six site products only (lib/bookings/live.ts relies on that). */
export function defaultVerifier(opts: VerifierOptions = {}) {
  const keyId = process.env.APPLE_IAP_KEY_ID;
  const issuerId = process.env.APPLE_IAP_ISSUER_ID;
  const privateKey = (process.env.APPLE_IAP_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  const bundleId = process.env.APPLE_BUNDLE_ID;
  const appAppleIdRaw = Number(process.env.APPLE_APP_ID);
  const appAppleId = Number.isFinite(appAppleIdRaw) && appAppleIdRaw > 0 ? appAppleIdRaw : undefined;
  if (!keyId || !issuerId || !privateKey || !bundleId) throw new VerifyFailure('apple-unavailable');

  const apiEnv = { Production: Environment.PRODUCTION, Sandbox: Environment.SANDBOX } as const;
  const clients: Partial<Record<IosEnv, AppStoreServerAPIClient>> = {};

  const client = (env: IosEnv) =>
    (clients[env] ??= new AppStoreServerAPIClient(privateKey, keyId, issuerId, bundleId, apiEnv[env]));

  const lookup: AppleLookup = async (env, transactionId) => {
    // Pre-launch: no app id yet, so production can't be verified; go straight to sandbox.
    if (env === 'Production' && appAppleId === undefined) return { status: 404 };
    try {
      const r = await client(env).getTransactionInfo(transactionId);
      return { status: 200, signedTransactionInfo: r.signedTransactionInfo };
    } catch (e) {
      if (e instanceof APIException) return { status: e.httpStatusCode };
      throw e;
    }
  };

  const statuses: AppleStatuses = async (env, transactionId) => {
    try {
      const r = await client(env).getAllSubscriptionStatuses(transactionId);
      return {
        status: 200,
        items: (r.data || []).flatMap((g) => (g.lastTransactions || []).map((t) => ({
          status: t.status == null ? undefined : Number(t.status),
          originalTransactionId: t.originalTransactionId,
          signedTransactionInfo: t.signedTransactionInfo,
          signedRenewalInfo: t.signedRenewalInfo,
        }))),
      };
    } catch (e) {
      if (e instanceof APIException) return { status: e.httpStatusCode };
      throw e;
    }
  };

  const decode: AppleDecode = async (env, signed) => {
    let p;
    try {
      p = await signedDataVerifierFor(env).verifyAndDecodeTransaction(signed);
    } catch (e) {
      if (e instanceof VerificationException) {
        if (e.status === VerificationStatus.INVALID_APP_IDENTIFIER) throw new VerifyFailure('bad-bundle');
        if (e.status === VerificationStatus.INVALID_ENVIRONMENT) throw new VerifyFailure('not-found');
      }
      throw e; // other failures: makeVerifier maps to apple-unavailable
    }
    return toDecodedTransaction(p);
  };

  const decodeRenewal: AppleDecodeRenewal = async (env, signed) => {
    const r = await signedDataVerifierFor(env).verifyAndDecodeRenewalInfo(signed);
    return { autoRenewStatus: r.autoRenewStatus == null ? undefined : Number(r.autoRenewStatus) };
  };

  return makeVerifier({
    lookup, decode, statuses, bundleId, decodeRenewal,
    products: opts.products, includeAccount: opts.includeAccount, includeRenewal: opts.includeRenewal,
  });
}

/** Verifies and decodes a transaction JWS the DEVICE sent (StoreKit 2 Transaction.jwsRepresentation) with the shared verifier. */
export async function verifyDeviceTransaction(env: IosEnv, jws: string): Promise<DecodedTransaction> {
  return toDecodedTransaction(await signedDataVerifierFor(env).verifyAndDecodeTransaction(jws));
}
