import fs from 'node:fs';
import path from 'node:path';
import { AppStoreServerAPIClient, APIException, SignedDataVerifier, VerificationException, VerificationStatus, Environment } from '@apple/app-store-server-library';

export type IosEnv = 'Production' | 'Sandbox';

export interface VerifiedTx {
  originalTransactionId: string;
  transactionId: string;
  productId: string;
  environment: IosEnv;
  /** From the purchase's LATEST transaction (Get All Subscription Statuses), not the id the app sent. */
  expiresAt: number | null;
  revoked: boolean;
  /** Apple subscription status: 1 Active, 2 Expired, 3 Billing retry, 4 Billing grace period, 5 Revoked. */
  status?: number;
}

export type VerifyError = 'not-found' | 'bad-bundle' | 'bad-product' | 'apple-unavailable';

export class VerifyFailure extends Error {
  constructor(public code: VerifyError) {
    super(code);
    this.name = 'VerifyFailure';
  }
}

export const IOS_PRODUCT_IDS: readonly string[] = [
  'com.ibrahim1774.aibarber.hosting.monthly',
  'com.ibrahim1774.aibarber.hosting.yearly',
];

// Lives in txStatus.ts (no Apple SDK import) so purchases.ts can use it
// without pulling the App Store library into every function that reads rows.
export { isActive } from './txStatus.js';

export interface AppleLookup {
  (env: IosEnv, transactionId: string): Promise<{ status: number; signedTransactionInfo?: string }>;
}
export interface AppleDecode {
  (env: IosEnv, signed: string): Promise<{
    bundleId: string; productId: string; originalTransactionId: string; transactionId: string;
    expiresDate?: number; revocationDate?: number; purchaseDate?: number;
  }>;
}

/** One lastTransactions entry from Get All Subscription Statuses (flattened across subscription groups). */
export interface AppleStatusItem {
  status?: number;
  originalTransactionId?: string;
  signedTransactionInfo?: string;
}
export interface AppleStatuses {
  (env: IosEnv, transactionId: string): Promise<{ status: number; items?: AppleStatusItem[] }>;
}

const ENVS: IosEnv[] = ['Production', 'Sandbox'];

const unavailable = () => new VerifyFailure('apple-unavailable');

export function makeVerifier(deps: { lookup: AppleLookup; decode: AppleDecode; statuses: AppleStatuses; bundleId: string }) {
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
      if (!IOS_PRODUCT_IDS.includes(d.productId)) throw new VerifyFailure('bad-product');

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

      return {
        originalTransactionId: d.originalTransactionId,
        transactionId: d.transactionId,
        productId: d.productId,
        environment: env,
        expiresAt: latest.expiresDate ?? null,
        revoked: latest.revocationDate != null || item.status === 5,
        status: item.status,
      };
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
export function lazyDefaultVerifier(): (transactionId: string) => Promise<VerifiedTx> {
  let verifier: ((id: string) => Promise<VerifiedTx>) | undefined;
  return (id) => {
    try {
      verifier ??= defaultVerifier();
    } catch (e) {
      return Promise.reject(e);
    }
    return verifier(id);
  };
}

export function defaultVerifier() {
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
    return {
      bundleId: p.bundleId, productId: p.productId,
      originalTransactionId: p.originalTransactionId, transactionId: p.transactionId,
      expiresDate: p.expiresDate, revocationDate: p.revocationDate,
    };
  };

  return makeVerifier({ lookup, decode, statuses, bundleId });
}
