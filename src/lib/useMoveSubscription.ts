import { useCallback, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { api } from '@/lib/api';
import { PAYMENTS_RESET_NOTICE } from '@/lib/claimCopy';
import { MOVE_ERROR, MOVE_CONFIRM_CANCEL, MOVE_CONFIRM_OK, MOVE_CONFIRM_TITLE, moveConfirmMessage, moveSubscription, type MoveConfirmInfo, type MoveResult } from '@/lib/moveSubscription';
import { useLatestTransactionId } from '@/lib/paywall';
import { refreshPlanAfterTransfer } from '@/lib/plan';
import { recheckSubscriptionStatus } from '@/lib/subscriptionStatus';

/** The confirm Alert as a promise: true only for "Move here". Cancel (default) and a dismiss both answer false. */
export const confirmMoveAlert = (info: MoveConfirmInfo): Promise<boolean> =>
  new Promise((resolve) => {
    Alert.alert(
      MOVE_CONFIRM_TITLE,
      moveConfirmMessage(info),
      [
        { text: MOVE_CONFIRM_CANCEL, style: 'cancel', onPress: () => resolve(false) },
        { text: MOVE_CONFIRM_OK, onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });

/**
 * Runs the move. On success the plan and entitlements are refreshed before `onMoved` runs (so the tabs unlock, or the
 * claim screen's publish resumes against a purchase that is now this account's). `error` is the one friendly sentence.
 */
export function useMoveSubscription(opts: { transactionId?: () => Promise<string | null>; onMoved?: () => void | Promise<void> } = {}) {
  const latest = useLatestTransactionId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const busyRef = useRef(false);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const run = useCallback(async (): Promise<MoveResult | null> => {
    if (busyRef.current) return null;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const r = await moveSubscription({
        transfer: api.transfer,
        transactionId: async () => (await optsRef.current.transactionId?.()) ?? (await latest()),
        confirm: confirmMoveAlert,
      });
      if (r.kind === 'error') setError(r.message);
      if (r.kind === 'moved') {
        // Moved, or already this account's: either way re-read the plan so the lock card goes away. If that fails,
        // or the server still does not call the purchase ours, say so; never leave a button that did nothing.
        let owned = false;
        try {
          owned = (await refreshPlanAfterTransfer(r.transactionId)).purchaseAccount === 'self';
        } catch {
          owned = false;
        }
        recheckSubscriptionStatus(true);
        if (!owned) {
          setError(MOVE_ERROR.refresh);
          return r;
        }
        if (r.paymentsReset) setNotice(PAYMENTS_RESET_NOTICE);
        await optsRef.current.onMoved?.();
      }
      return r;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [latest]);

  return { run, busy, error, notice };
}
