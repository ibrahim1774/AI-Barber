import { signedDataVerifierFor, toDecodedTransaction, type AppleDecode, type IosEnv } from './appleVerify.js';
import { supabasePurchases, type PurchasesRepo, type PurchaseRow } from './purchases.js';
import { grants } from './tiers.js';

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
  // REFUND_REVERSED: Apple reinstated the purchase, so the stored revocation is cleared.
  const reinstated = n.notificationType === 'REFUND_REVERSED';
  // The transaction a same-group upgrade replaced carries a revocationDate, but the
  // purchase (same originalTransactionId) lives on in the upgraded product: never a revocation.
  const upgradedAway = tx.isUpgraded === true;
  const revokedAt = reinstated || upgradedAway ? null : tx.revocationDate ?? (REVOKING_TYPES.has(n.notificationType) ? now : null);
  // The product before this notification, to spot a downgrade (M1). Best effort.
  let before: PurchaseRow | null = null;
  if (deps.repo.markLinksDue && !upgradedAway) {
    before = await deps.repo.get(tx.originalTransactionId).catch(() => null);
  }
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
  await markDowngradedLinks(before, tx.productId, deps, now);
  return { status: 200, body: { ok: true } };
}

/**
 * e2e M1: a downgrade at renewal (Store -> Website) leaves the live site's Book / Shop buttons
 * pointing at paused pages until the app republishes. When the product just written stops
 * granting bookings or store, stamp links_due_at on a published site; the sweep strips the
 * stored copy and redeploys. Never fails the notification (Apple must not retry for this).
 */
async function markDowngradedLinks(before: PurchaseRow | null, productId: string, deps: NotificationDeps, now: number) {
  if (!before || !deps.repo.markLinksDue) return;
  const lost = (['bookings', 'store'] as const).some((e) => grants(before.product_id, e) && !grants(productId, e));
  if (!lost) return;
  try {
    const after = await deps.repo.get(before.original_transaction_id);
    // Only when the downgrade was actually recorded (never backwards: a late, older notification
    // does not move product_id) and there is a live site to fix.
    if (!after || after.product_id !== productId || !after.site_slug || !after.published_at || after.taken_down_at || after.revoked_at) return;
    await deps.repo.markLinksDue(after.original_transaction_id, now);
    console.log(`[ios/apple-notification] ${after.site_slug}: plan now ${productId}; Book/Shop links queued for the sweep`);
  } catch (e: any) {
    console.warn('[ios/apple-notification] queueing the link strip failed (ignored; the next publish strips them):', e?.message || e);
  }
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
