// A purchase the server refused to tie (or, in ONE_SITE_GUARD=alert, would have refused): the record (migration 039), the alert to the
// owner and the one email to the barber. NEVER throws: a failure here must not change the answer of a publish, a plan check or a Move.
//   record  insert-ignore on (original_transaction_id, user_id)
//   alert   once per pair: claim `alerted_at` (conditional update where it is still null), alertOwner, on failure release the claim
//   email   once per pair, ONLY when `email` is true (a real refusal: ONE_SITE_GUARD=1 and a Production purchase). Claim `emailed_at`, send
//           with an idempotency key, on failure release. There is no separate "mark": the claim stamp is the sent time (039 has no resend id column).
//   alert mode never emails: the purchase WAS tied there, so "the new subscription was not used" would be false.
// Claim/send/release follows lib/ios/emailFlows.ts billing (claimBilling / send / markBilling / releaseBilling).
// Known limit (same as the billing mail): a crash between the claim and the send loses that one email; nothing is ever sent twice.
// Missing table (migration 039 not applied): no ledger, so no email; the alert goes to the log only.
import { isInternalTestEmail, liveSignupNudgeDeps, type AdminUser } from '../webApp/signupNudges.js';
import { alertOwner, sendMail, type Mail } from '../webApp/emails.js';
import { isSuppressed } from '../webApp/suppressions.js';
import { sbRest } from '../webApp/webAppServer.js';
import { blockedPurchaseEmail } from './blockedEmails.js';

export type BlockReason = 'web-account' | 'other-apple-id' | 'mixed';
export type Stamp = 'alerted_at' | 'emailed_at';

export interface BlockedInfo {
  /** The purchase, or 'web-publish' for a web publish that was refused an address. */
  otid: string;
  uid: string;
  reason: BlockReason;
  /** The address the account already holds (for the alert text). */
  slug: string | null;
  /** The purchase's environment: only a Production purchase is ever emailed (as emailFlows). */
  environment: 'Production' | 'Sandbox' | null;
  /** The guard is enforcing: send the barber email. Alert mode passes false. */
  email: boolean;
  /** Where it happened, for the alert text. */
  where: string;
}

export interface BlockedDeps {
  now(): number;
  /** Insert-ignore; true when this call created the row. Throws {status:404} while the table is missing. */
  record(otid: string, uid: string, reason: BlockReason): Promise<boolean>;
  /** Atomic: true for the one caller that moved the stamp from null to `stamp`. */
  claim(field: Stamp, otid: string, uid: string, stamp: string): Promise<boolean>;
  /** Reset the stamp to null only while it still equals `stamp`. */
  release(field: Stamp, otid: string, uid: string, stamp: string): Promise<void>;
  adminUser(uid: string): Promise<AdminUser | null>;
  isSuppressed(email: string): Promise<boolean>;
  send(to: string, mail: Mail, idempotencyKey: string): Promise<string>;
  alert(subject: string, lines: string[]): Promise<void>;
}

const short = (id: string) => id.slice(-4);

export async function reportBlocked(info: BlockedInfo, deps: BlockedDeps = liveBlockedDeps()): Promise<void> {
  try {
    try { await deps.record(info.otid, info.uid, info.reason); }
    catch (e: any) {
      if (e?.status === 404) { console.error(`[one-site] ALERT (no ledger: migration 039 missing) ${info.where}: ${info.reason} otid=...${short(info.otid)} user=${info.uid}`); return; }
      throw e;
    }
    // Alert, once per pair.
    const aStamp = new Date(deps.now()).toISOString();
    if (await deps.claim('alerted_at', info.otid, info.uid, aStamp)) {
      try {
        await deps.alert(info.email ? 'Prime Barber: Apple purchase not tied to a web account' : 'Prime Barber: one-site guard would refuse an Apple purchase (alert mode)', [
          `reason: ${info.reason}`, `where: ${info.where}`, `purchase: ${info.otid}`, `user: ${info.uid}`, `environment: ${info.environment ?? '(unknown)'}`,
          `account address: ${info.slug ?? '(none)'}`, `enforcing: ${info.email ? 'yes, the purchase was not tied' : 'no (alert mode), the purchase was tied as before'}`,
        ]);
      } catch (e: any) {
        await deps.release('alerted_at', info.otid, info.uid, aStamp).catch(() => {});
        console.error('[one-site] alert failed:', e?.message || e);
      }
    }
    if (!info.email || info.environment !== 'Production' || info.reason === 'mixed') return;
    // Email, once per pair. Every stop condition is checked BEFORE the claim, so a held email can still go out later.
    const user = await deps.adminUser(info.uid);
    const to = user?.email?.trim();
    if (!to || isInternalTestEmail(to) || (await deps.isSuppressed(to))) return;
    const eStamp = new Date(deps.now()).toISOString();
    if (!(await deps.claim('emailed_at', info.otid, info.uid, eStamp))) return;
    try {
      await deps.send(to, blockedPurchaseEmail(info.reason), `one-site:blocked:${info.otid}:${info.uid}`);
      console.info('[one-site] blocked-purchase email sent', { userId: info.uid, reason: info.reason });
    } catch (e: any) {
      await deps.release('emailed_at', info.otid, info.uid, eStamp).catch(() => {});
      console.error('[one-site] blocked-purchase email failed:', e?.status ?? e?.message ?? e);
    }
  } catch (e: any) {
    console.error('[one-site] could not report a blocked purchase:', e?.status ?? e?.message ?? e);
  }
}

const enc = encodeURIComponent;
export function liveBlockedDeps(rest: typeof sbRest = sbRest): BlockedDeps {
  const pair = (otid: string, uid: string) => `blocked_purchases?original_transaction_id=eq.${enc(otid)}&user_id=eq.${enc(uid)}`;
  return {
    now: () => Date.now(),
    async record(otid, uid, reason) {
      const got = await rest('blocked_purchases?on_conflict=original_transaction_id,user_id', {
        method: 'POST', prefer: 'resolution=ignore-duplicates,return=representation', body: { original_transaction_id: otid, user_id: uid, reason },
      });
      return Array.isArray(got) && got.length > 0;
    },
    async claim(field, otid, uid, stamp) {
      const got = await rest(`${pair(otid, uid)}&${field}=is.null`, { method: 'PATCH', prefer: 'return=representation', body: { [field]: stamp } });
      return Array.isArray(got) && got.length > 0;
    },
    async release(field, otid, uid, stamp) {
      await rest(`${pair(otid, uid)}&${field}=eq.${enc(stamp)}`, { method: 'PATCH', prefer: 'return=minimal', body: { [field]: null } });
    },
    adminUser: (uid) => liveSignupNudgeDeps('live', rest).adminUser(uid),
    isSuppressed: (email) => isSuppressed(email, rest),
    send: (to, mail, key) => sendMail(to, mail, fetch, key),
    alert: alertOwner,
  };
}
