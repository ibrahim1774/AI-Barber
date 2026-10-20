import { signedDataVerifierFor, type AppleDecode, type IosEnv } from './appleVerify.js';
import { supabasePurchases, type PurchasesRepo } from './purchases.js';

export interface DecodedNotification {
  notificationType: string;
  subtype?: string;
  data?: { environment?: string; bundleId?: string; signedTransactionInfo?: string };
}

export interface NotificationDeps {
  decodeNotification(p: string): Promise<DecodedNotification>;
  decodeTransaction: AppleDecode;
  repo: PurchasesRepo;
  bundleId: string;
  now?: () => number;
}

export interface NotificationResult {
  status: 200 | 400 | 500;
  body: object;
}

const REVOKING_TYPES = new Set(['REFUND', 'REVOKE']);

/** Records subscription state only; never publishes or unpublishes. */
export async function handleAppleNotification(signedPayload: string, deps: NotificationDeps): Promise<NotificationResult> {
  // Misconfiguration (APPLE_BUNDLE_ID unset), not a bad request: 500 so Apple
  // retries once it is fixed, instead of every notification being "ignored".
  if (!deps.bundleId) {
    console.error('[ios/apple-notification] APPLE_BUNDLE_ID is not set; refusing notification so Apple retries');
    return { status: 500, body: { error: 'temporarily-unavailable' } };
  }

  let n: DecodedNotification;
  try {
    n = await deps.decodeNotification(signedPayload);
  } catch (e: any) {
    console.error('[ios/apple-notification] could not verify signedPayload:', e?.message || e);
    return { status: 400, body: { error: 'bad-signature' } };
  }

  const data = n.data;
  if (!data?.signedTransactionInfo) return { status: 200, body: { ignored: 'no-transaction' } };
  if (data.environment !== 'Production' && data.environment !== 'Sandbox') {
    return { status: 200, body: { ignored: 'environment' } };
  }
  if (data.bundleId !== deps.bundleId) return { status: 200, body: { ignored: 'bundle' } };
  const environment: IosEnv = data.environment;

  let tx: Awaited<ReturnType<AppleDecode>>;
  try {
    tx = await deps.decodeTransaction(environment, data.signedTransactionInfo);
  } catch (e: any) {
    console.error(`[ios/apple-notification] ${n.notificationType}: could not verify signedTransactionInfo:`, e?.message || e);
    return { status: 400, body: { error: 'bad-transaction' } };
  }
  if (tx.bundleId !== deps.bundleId) return { status: 200, body: { ignored: 'bundle' } };

  const now = (deps.now ?? Date.now)();
  // REFUND_REVERSED: Apple reinstated the purchase, so the stored revocation is cleared.
  const reinstated = n.notificationType === 'REFUND_REVERSED';
  const revokedAt = reinstated ? null : tx.revocationDate ?? (REVOKING_TYPES.has(n.notificationType) ? now : null);
  try {
    await deps.repo.applyNotification({
      otid: tx.originalTransactionId,
      productId: tx.productId,
      environment,
      expiresAt: tx.expiresDate ?? null,
      revokedAt,
      type: n.notificationType,
      ...(reinstated ? { clearRevoked: true } : {}),
    });
  } catch (e: any) {
    console.error('[ios/apple-notification] repo error:', e?.message || e);
    return { status: 500, body: { error: 'temporarily-unavailable' } }; // Apple retries
  }
  return { status: 200, body: { ok: true } };
}

export function liveNotificationDeps(): NotificationDeps {
  const bundleId = process.env.APPLE_BUNDLE_ID || '';
  return {
    bundleId,
    repo: supabasePurchases(),
    decodeTransaction: async (env, signed) => {
      const p = await signedDataVerifierFor(env).verifyAndDecodeTransaction(signed);
      return {
        bundleId: p.bundleId, productId: p.productId,
        originalTransactionId: p.originalTransactionId, transactionId: p.transactionId,
        expiresDate: p.expiresDate, revocationDate: p.revocationDate,
      };
    },
    async decodeNotification(p) {
      let firstErr: unknown;
      for (const env of ['Production', 'Sandbox'] as const) {
        try {
          const d = await signedDataVerifierFor(env).verifyAndDecodeNotification(p);
          return {
            notificationType: String(d.notificationType),
            subtype: d.subtype == null ? undefined : String(d.subtype),
            data: d.data && {
              environment: d.data.environment == null ? undefined : String(d.data.environment),
              bundleId: d.data.bundleId,
              signedTransactionInfo: d.data.signedTransactionInfo,
            },
          };
        } catch (e) {
          firstErr ??= e;
        }
      }
      throw firstErr;
    },
  };
}
