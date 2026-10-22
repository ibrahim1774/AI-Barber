import { signedDataVerifierFor, toDecodedTransaction, type AppleDecode, type IosEnv } from './appleVerify.js';
import { supabasePurchases, type PurchasesRepo } from './purchases.js';
import { isDomainProduct } from './tiers.js';

/** One App Store notification about the custom-domain subscription (lib/ios/domainFlow.ts). */
export interface DomainNotification {
  otid: string;
  type: string;
  subtype?: string;
  environment: IosEnv;
  expiresAt: number | null;
  /** Set on REFUND / REVOKE (or a transaction carrying a revocationDate). */
  revokedAt: number | null;
  /** REFUND_REVERSED: the purchase is live again. */
  reinstated: boolean;
}

export interface DomainNotificationSink {
  applyNotification(n: DomainNotification): Promise<unknown>;
}

export interface DecodedNotification {
  notificationType: string;
  subtype?: string;
  data?: { environment?: string; bundleId?: string; signedTransactionInfo?: string };
}

export interface NotificationDeps {
  decodeNotification(p: string): Promise<DecodedNotification>;
  decodeTransaction: AppleDecode;
  repo: PurchasesRepo;
  /**
   * The custom-domain lifecycle. The domain product is routed here and NEVER to `repo`
   * (ios_purchases), so it can never become a site purchase. Absent: 500 so Apple retries.
   */
  domain?: DomainNotificationSink;
  bundleId: string;
  now?: () => number;
}

export interface NotificationResult {
  status: 200 | 400 | 500;
  body: object;
}

const REVOKING_TYPES = new Set(['REFUND', 'REVOKE']);
// A new purchase/renewal in the same subscription: with an unrevoked
// transaction bought after a stored revocation, the purchase is live again
// (resubscribe after a refund keeps the originalTransactionId).
const PURCHASE_TYPES = new Set(['SUBSCRIBED', 'DID_RENEW']);

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

  if (isDomainProduct(tx.productId)) {
    if (!deps.domain) {
      console.error('[ios/apple-notification] domain notification but no domain handler wired; refusing so Apple retries');
      return { status: 500, body: { error: 'temporarily-unavailable' } };
    }
    const reinstatedDomain = n.notificationType === 'REFUND_REVERSED';
    try {
      await deps.domain.applyNotification({
        otid: tx.originalTransactionId,
        type: n.notificationType,
        ...(n.subtype ? { subtype: n.subtype } : {}),
        environment,
        expiresAt: tx.expiresDate ?? null,
        revokedAt: reinstatedDomain ? null : tx.revocationDate ?? (REVOKING_TYPES.has(n.notificationType) ? now : null),
        reinstated: reinstatedDomain,
      });
    } catch (e: any) {
      console.error('[ios/apple-notification] domain handler error:', e?.message || e);
      return { status: 500, body: { error: 'temporarily-unavailable' } }; // Apple retries
    }
    return { status: 200, body: { ok: true } };
  }

  // REFUND_REVERSED: Apple reinstated the purchase, so the stored revocation is cleared.
  const reinstated = n.notificationType === 'REFUND_REVERSED';
  // The transaction a same-group upgrade replaced carries a revocationDate, but the
  // purchase (same originalTransactionId) lives on in the upgraded product: never a revocation.
  const upgradedAway = tx.isUpgraded === true;
  const revokedAt = reinstated || upgradedAway ? null : tx.revocationDate ?? (REVOKING_TYPES.has(n.notificationType) ? now : null);
  try {
    await deps.repo.applyNotification({
      otid: tx.originalTransactionId,
      productId: tx.productId,
      environment,
      expiresAt: tx.expiresDate ?? null,
      revokedAt,
      type: n.notificationType,
      // Orders the product write (never backwards); an upgraded-away product is never written.
      ...(tx.purchaseDate != null ? { purchasedAt: tx.purchaseDate } : {}),
      ...(upgradedAway ? { isUpgraded: true } : {}),
      ...(reinstated ? { clearRevoked: true } : {}),
      ...(!reinstated && PURCHASE_TYPES.has(n.notificationType) && tx.revocationDate == null && tx.purchaseDate != null
        ? { clearRevokedBefore: tx.purchaseDate }
        : {}),
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
    decodeTransaction: async (env, signed) =>
      toDecodedTransaction(await signedDataVerifierFor(env).verifyAndDecodeTransaction(signed)),
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
