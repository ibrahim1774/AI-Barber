import { ApiError } from '@/lib/api';
import { claimDomain, domainStatus, loadDomainClaim, saveDomainClaim } from '@/lib/domains/api';
import { claimOutcome, rememberedClaim, type ClaimOutcome, type DomainClaimRecord, type DomainStatus } from '@/lib/domains/model';
import { emitSiteLive } from '@/lib/siteEvents';
import { loadSite } from '@/lib/siteStore';
import { supabase } from '@/lib/supabase';

export const accessToken = async (): Promise<string | null> => {
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
};

/**
 * Sends a claim and reads what it means. After the request went out, a timeout or a "try later" answer is
 * not the end: the server may be registering already, so status is read and, when there is one, the
 * progress takes over (it resumes on its own; a claim never buys twice).
 */
export async function sendClaim(rec: Required<DomainClaimRecord>): Promise<ClaimOutcome> {
  let out: ClaimOutcome;
  try {
    const a = await claimDomain(
      { transactionId: rec.transactionId, siteTransactionId: rec.siteTransactionId, domain: rec.domain },
      await accessToken(),
    );
    out = claimOutcome(a.status, a.body);
  } catch (e) {
    out = { kind: 'retry-later', code: e instanceof ApiError ? e.code : 'network' };
  }
  if (out.kind === 'retry-later') {
    const s = await domainStatus(rec.transactionId).catch(() => null);
    if (s && s.state !== 'none') out = { kind: s.state === 'live' ? 'live' : s.state.startsWith('failed:') ? 'failed' : 'progress', status: s };
  }
  if (out.kind === 'taken' || out.kind === 'not-eligible') await saveDomainClaim(null);
  return out;
}

/**
 * At launch (and when the domain screen opens): the remembered claim, dropped when it no longer matches the
 * active domain subscription or this site; when the server has nothing for it yet (killed before the claim
 * reached it), the claim is sent again. Never throws. Returns the status now known, or null.
 */
export async function resumeDomainClaim(activeDomainTx: string | null): Promise<DomainStatus | null> {
  try {
    const stored = await loadDomainClaim();
    const site = await loadSite().catch(() => null);
    const rec = rememberedClaim(stored, activeDomainTx, site?.transactionId ?? null);
    if (stored && !rec) await saveDomainClaim(null);
    if (!rec) return null;
    const s = await domainStatus(rec.transactionId).catch(() => null);
    if (!s || s.state !== 'none') return s;
    const siteTx = rec.siteTransactionId ?? site?.transactionId;
    if (!siteTx) return s;
    const out = await sendClaim({ ...rec, siteTransactionId: siteTx });
    const now = 'status' in out && out.status ? out.status : s;
    if (now.state === 'live' && site) emitSiteLive(site);
    return now;
  } catch {
    return null;
  }
}
