import fs from 'node:fs';
import path from 'node:path';
import { AppStoreServerAPIClient, APIException, SignedDataVerifier, VerificationException, VerificationStatus, Environment } from '@apple/app-store-server-library';

export type IosEnv = 'Production' | 'Sandbox';

export interface VerifiedTx {
  originalTransactionId: string;
  transactionId: string;
  productId: string;
  environment: IosEnv;
  expiresAt: number | null;
  revoked: boolean;
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

export function isActive(tx: VerifiedTx, now: number = Date.now()): boolean {
  return !tx.revoked && (tx.expiresAt === null || tx.expiresAt > now);
}

export interface AppleLookup {
  (env: IosEnv, transactionId: string): Promise<{ status: number; signedTransactionInfo?: string }>;
}
export interface AppleDecode {
  (env: IosEnv, signed: string): Promise<{
    bundleId: string; productId: string; originalTransactionId: string; transactionId: string;
    expiresDate?: number; revocationDate?: number;
  }>;
}

const ENVS: IosEnv[] = ['Production', 'Sandbox'];

export function makeVerifier(deps: { lookup: AppleLookup; decode: AppleDecode; bundleId: string }) {
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
      return {
        originalTransactionId: d.originalTransactionId,
        transactionId: d.transactionId,
        productId: d.productId,
        environment: env,
        expiresAt: d.expiresDate ?? null,
        revoked: d.revocationDate != null,
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

  const lookup: AppleLookup = async (env, transactionId) => {
    // Pre-launch: no app id yet, so production can't be verified; go straight to sandbox.
    if (env === 'Production' && appAppleId === undefined) return { status: 404 };
    clients[env] ??= new AppStoreServerAPIClient(privateKey, keyId, issuerId, bundleId, apiEnv[env]);
    try {
      const r = await clients[env].getTransactionInfo(transactionId);
      return { status: 200, signedTransactionInfo: r.signedTransactionInfo };
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

  return makeVerifier({ lookup, decode, bundleId });
}
