import { useEffect, useState } from 'react';
import { domainStatus, loadDomainClaim } from '@/lib/domains/api';
import { DOMAIN_PRICE_LINE, settingsDetail, statusView } from '@/lib/domains/model';
import { useLatestDomainTransactionId } from '@/lib/paywall';

export type DomainOffer = {
  /** The answer is in. Until then nothing that depends on it shows. */
  known: boolean;
  /** The site has (or is getting, or had) a custom domain: no buy offer. */
  hasDomain: boolean;
  /** The Settings line: the domain and its state, or the price line. */
  detail: string;
};

/**
 * Whether this site already has a custom domain, read the way the Settings row always has: the remembered
 * claim, else the newest active domain subscription, then its server status. Re-reads when `active` turns on
 * (screen focused / sheet opened). A status the server cannot give still counts as a domain when one is remembered.
 */
export function useDomainOffer(active: boolean): DomainOffer {
  const latestDomainTx = useLatestDomainTransactionId();
  const [offer, setOffer] = useState<DomainOffer>({ known: false, hasDomain: false, detail: DOMAIN_PRICE_LINE });
  useEffect(() => {
    if (!active) return;
    let alive = true;
    (async () => {
      const rec = await loadDomainClaim().catch(() => null);
      const tx = rec?.transactionId ?? (await latestDomainTx().catch(() => null));
      if (!tx) return alive && setOffer({ known: true, hasDomain: false, detail: DOMAIN_PRICE_LINE });
      const st = await domainStatus(tx).catch(() => null);
      if (!alive) return;
      if (st) {
        setOffer({ known: true, hasDomain: statusView(st).phase !== 'none' && !!st.domain, detail: settingsDetail(st) });
      } else if (rec) {
        setOffer({ known: true, hasDomain: true, detail: rec.domain });
      } else {
        // A paid slot with no readable status: the domain screen decides; do not push a second purchase from here.
        setOffer({ known: false, hasDomain: false, detail: DOMAIN_PRICE_LINE });
      }
    })();
    return () => {
      alive = false;
    };
  }, [active, latestDomainTx]);
  return offer;
}
