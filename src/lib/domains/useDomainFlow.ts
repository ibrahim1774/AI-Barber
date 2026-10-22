import { useCallback, useEffect, useRef, useState } from 'react';
import { track } from '@/lib/analytics';
import { ApiError } from '@/lib/api';
import { claimDomain, domainStatus, loadDomainClaim, saveDomainClaim } from '@/lib/domains/api';
import {
  DOMAIN_PLACEMENT, claimOutcome, statusView, type ClaimOutcome, type DomainClaimRecord, type DomainStatus,
} from '@/lib/domains/model';
import { useLatestDomainTransactionId, useLatestTransactionId, usePaywall } from '@/lib/paywall';
import { findTransactionId } from '@/lib/publish';
import { emitSiteLive } from '@/lib/siteEvents';
import { loadSite } from '@/lib/siteStore';
import { supabase } from '@/lib/supabase';

export type BuyResult =
  | ClaimOutcome
  | { kind: 'declined' }
  | { kind: 'unconfirmed' }
  | { kind: 'no-site' }
  | { kind: 'busy' };

/** A slot is free when nothing is linked to it yet, or its last attempt failed and can be repointed. */
export function slotIsFree(s: DomainStatus | null): boolean {
  if (!s || s.state === 'none') return true;
  const v = statusView(s);
  return v.phase === 'failed' && (v.pickAnother || v.retrySame);
}

const accessToken = async (): Promise<string | null> => {
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
};

/**
 * The custom-domain flow: what is there now (the remembered claim, else the active domain subscription,
 * and its server status), buying a name (the `custom_domain` paywall unless an unused paid slot exists,
 * then claim), retrying a claim, and polling. One buy / claim at a time: a second tap does nothing.
 * When the domain goes Live, the site's share links are refreshed (onSiteLive).
 */
export function useDomainFlow() {
  const paywall = usePaywall();
  const latestDomainTx = useLatestDomainTransactionId();
  const latestSiteTx = useLatestTransactionId();
  const [record, setRecord] = useState<DomainClaimRecord | null>(null);
  const [domainTx, setDomainTx] = useState<string | null>(null);
  const [status, setStatus] = useState<DomainStatus | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const wasLive = useRef(false);

  const apply = useCallback((s: DomainStatus | null) => {
    setStatus(s);
    const live = s?.state === 'live';
    if (live && !wasLive.current) {
      // The server switched the site's public address: share links / QR re-resolve.
      void loadSite().then((site) => site && emitSiteLive(site)).catch(() => {});
    }
    wasLive.current = live;
  }, []);

  const refresh = useCallback(async () => {
    const rec = await loadDomainClaim();
    setRecord(rec);
    const tx = rec?.transactionId ?? (await latestDomainTx().catch(() => null));
    setDomainTx(tx);
    if (tx) {
      try {
        apply(await domainStatus(tx));
      } catch {
        // keep what is shown; the next poll tries again
      }
    } else {
      apply(null);
    }
    setLoaded(true);
  }, [latestDomainTx, apply]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const claim = useCallback(async (tx: string, domain: string): Promise<BuyResult> => {
    const site = await loadSite().catch(() => null);
    const siteTx = site?.transactionId ?? (await latestSiteTx().catch(() => null));
    if (!siteTx) return { kind: 'no-site' };
    const rec = { transactionId: tx, domain };
    await saveDomainClaim(rec);
    setRecord(rec);
    setDomainTx(tx);
    let out: ClaimOutcome;
    try {
      const a = await claimDomain({ transactionId: tx, siteTransactionId: siteTx, domain }, await accessToken());
      out = claimOutcome(a.status, a.body);
    } catch (e) {
      out = { kind: 'retry-later', code: e instanceof ApiError ? e.code : 'network' };
    }
    track('domain_claim', { result: out.kind });
    if ('status' in out && out.status) apply(out.status);
    // Nothing reserved: forget the name so the next search starts clean (the slot stays paid).
    if (out.kind === 'taken' || out.kind === 'not-eligible') {
      await saveDomainClaim(null);
      setRecord(null);
    }
    return out;
  }, [latestSiteTx, apply]);

  /** Buy `domain` (an eligible search result). */
  const buy = useCallback(async (domain: string): Promise<BuyResult> => {
    if (busyRef.current) return { kind: 'busy' };
    busyRef.current = true;
    setBusy(true);
    try {
      let tx = await latestDomainTx().catch(() => null);
      if (tx) {
        // An unused paid slot: claim without paying again. A slot already holding a name answers slot-in-use.
        const s = await domainStatus(tx).catch(() => null);
        if (s && !slotIsFree(s)) {
          apply(s);
          return { kind: 'slot-in-use', status: s };
        }
      } else {
        const r = await paywall(DOMAIN_PLACEMENT);
        if (r === 'declined') return { kind: 'declined' };
        tx = await findTransactionId(latestDomainTx);
        if (!tx) return { kind: 'unconfirmed' };
      }
      return await claim(tx, domain);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [latestDomainTx, paywall, claim, apply]);

  /** Claim the remembered name again (the server resumes where it stopped; never buys twice). */
  const retry = useCallback(async (): Promise<BuyResult> => {
    if (busyRef.current) return { kind: 'busy' };
    const rec = record ?? (await loadDomainClaim());
    if (!rec) return { kind: 'retry-later', code: 'no-claim' };
    busyRef.current = true;
    setBusy(true);
    try {
      return await claim(rec.transactionId, rec.domain);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [record, claim]);

  /** One status read (the screen polls this while the state says so). */
  const poll = useCallback(async () => {
    const tx = domainTx ?? record?.transactionId;
    if (!tx) return;
    try {
      apply(await domainStatus(tx));
    } catch {
      // try again next tick
    }
  }, [domainTx, record, apply]);

  return { loaded, record, domainTx, status, busy, refresh, buy, retry, poll };
}
