import { useCallback, useEffect, useRef, useState } from 'react';
import { track } from '@/lib/analytics';
import { domainStatus, loadDomainClaim, saveDomainClaim } from '@/lib/domains/api';
import {
  DOMAIN_PLACEMENT, rememberedClaim, statusView, type ClaimOutcome, type DomainClaimRecord, type DomainStatus,
} from '@/lib/domains/model';
import { resumeDomainClaim, sendClaim } from '@/lib/domains/resume';
import { useLatestDomainTransactionId, useLatestTransactionId, usePaywall } from '@/lib/paywall';
import { findTransactionId } from '@/lib/publish';
import { emitSiteLive } from '@/lib/siteEvents';
import { loadSite } from '@/lib/siteStore';

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

/**
 * The custom-domain flow: what is there now (the remembered claim, else the active domain subscription,
 * and its server status; a remembered claim the server never saw is sent again), buying a name (the
 * `custom_domain` paywall unless an unused paid slot exists, then claim), renewing an ended domain
 * (the paywall, then the same name, which the server re-attaches), retrying a claim, and polling.
 * One buy / claim at a time: a second tap does nothing. When the domain goes Live, the site's share links
 * are refreshed (onSiteLive).
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
    const active = await latestDomainTx().catch(() => null);
    // Resumes a claim the server never saw, and drops a record for another subscription or site.
    const resumed = await resumeDomainClaim(active);
    const site = await loadSite().catch(() => null);
    const rec = rememberedClaim(await loadDomainClaim(), active, site?.transactionId ?? null);
    setRecord(rec);
    const tx = rec?.transactionId ?? active;
    setDomainTx(tx);
    if (resumed) apply(resumed);
    else if (tx) apply(await domainStatus(tx).catch(() => null));
    else apply(null);
    setLoaded(true);
  }, [latestDomainTx, apply]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const claim = useCallback(async (tx: string, domain: string): Promise<BuyResult> => {
    const site = await loadSite().catch(() => null);
    const siteTx = site?.transactionId ?? (await latestSiteTx().catch(() => null));
    if (!siteTx) return { kind: 'no-site' };
    const rec = { transactionId: tx, domain, siteTransactionId: siteTx };
    await saveDomainClaim(rec);
    setRecord(rec);
    setDomainTx(tx);
    const out = await sendClaim(rec);
    track('domain_claim', { result: out.kind });
    if ('status' in out && out.status) apply(out.status);
    if (out.kind === 'taken' || out.kind === 'not-eligible') setRecord(null);
    return out;
  }, [latestSiteTx, apply]);

  const guarded = useCallback(async (work: () => Promise<BuyResult>): Promise<BuyResult> => {
    if (busyRef.current) return { kind: 'busy' };
    busyRef.current = true;
    setBusy(true);
    try {
      return await work();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, []);

  const payForSlot = useCallback(async (): Promise<string | BuyResult> => {
    const r = await paywall(DOMAIN_PLACEMENT);
    if (r === 'declined') return { kind: 'declined' };
    const tx = await findTransactionId(latestDomainTx);
    return tx ?? { kind: 'unconfirmed' };
  }, [paywall, latestDomainTx]);

  /** Buy `domain` (an eligible search result). */
  const buy = useCallback((domain: string) => guarded(async () => {
    let tx = await latestDomainTx().catch(() => null);
    if (tx) {
      // An unused paid slot: claim without paying again. A slot already holding a name shows that instead.
      const s = await domainStatus(tx).catch(() => null);
      if (s && !slotIsFree(s)) {
        apply(s);
        return { kind: 'slot-in-use', status: s };
      }
    } else {
      const paid = await payForSlot();
      if (typeof paid !== 'string') return paid;
      tx = paid;
    }
    return claim(tx, domain);
  }), [guarded, latestDomainTx, apply, payForSlot, claim]);

  /** The domain subscription ended (expired / inactive): pay again, then claim the same name (re-attached). */
  const renew = useCallback(() => guarded(async () => {
    const domain = status?.domain ?? record?.domain;
    if (!domain) return { kind: 'retry-later', code: 'no-claim' };
    let tx = await latestDomainTx().catch(() => null);
    if (!tx) {
      const paid = await payForSlot();
      if (typeof paid !== 'string') return paid;
      tx = paid;
    }
    return claim(tx, domain);
  }), [guarded, status, record, latestDomainTx, payForSlot, claim]);

  /** Claim the remembered name again (the server resumes where it stopped; never buys twice). */
  const retry = useCallback(() => guarded(async () => {
    const rec = record ?? (await loadDomainClaim());
    if (!rec) return { kind: 'retry-later', code: 'no-claim' };
    return claim(rec.transactionId, rec.domain);
  }), [guarded, record, claim]);

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

  return { loaded, record, domainTx, status, busy, refresh, buy, renew, retry, poll };
}
