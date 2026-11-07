// Email suppression list (unsubscribe, hard bounce, complaint) for the sign-up reminder mails.
// Keyed by lowercased email; kept after account deletion on purpose. Service role only.
import { sbRest } from './webAppServer.js';

export type SuppressionReason = 'unsubscribe' | 'bounce' | 'complaint';
type Rest = typeof sbRest;
const norm = (e: string) => e.trim().toLowerCase();
const missing = (e: any) => e?.status === 404; // PostgREST: table not created yet (migration 031 not applied)

/** True when this address must not get reminder mail. A missing table means nobody is suppressed yet; other errors throw (never fail open on an outage). */
export async function isSuppressed(email: string, rest: Rest = sbRest): Promise<boolean> {
  try {
    const rows = await rest(`web_app_email_suppressions?email=eq.${encodeURIComponent(norm(email))}&select=email&limit=1`);
    return Array.isArray(rows) && rows.length > 0;
  } catch (e) {
    if (missing(e)) return false;
    throw e;
  }
}

/** Adds the address (lowercased); a repeat is ignored, the first reason stays. Returns false when the table is missing. */
export async function suppress(email: string, reason: SuppressionReason, source: string, userId?: string | null, rest: Rest = sbRest): Promise<boolean> {
  try {
    await rest('web_app_email_suppressions?on_conflict=email', {
      method: 'POST', prefer: 'resolution=ignore-duplicates,return=minimal',
      body: { email: norm(email), reason, source, ...(userId ? { user_id: userId } : {}) },
    });
    return true;
  } catch (e) {
    if (missing(e)) return false;
    throw e;
  }
}
