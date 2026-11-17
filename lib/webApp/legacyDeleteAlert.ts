// APP_DELETE_CANCELS_WEB only: an in-app delete by an old aibarber.org customer cannot cancel their old Stripe plan
// (it carries no web-app tag), and deleting the account cascades their legacy `sites` rows. The delete proceeds as today;
// the owner is alerted so the old plan is cancelled by hand. Over-alerting is fine. Never throws, never emails the customer.
import { sbRest } from './webAppServer.js';
import { alertOwner } from './emails.js';
import { emailOfUser } from './userExists.js';

const enc = encodeURIComponent;

export interface LegacyDeleteDeps {
  ownerRows(userId: string): Promise<Array<{ slug: string; checkout_session_id: string | null }>>;
  legacySites(userId: string): Promise<Array<{ company_name: string | null }>>;
  email(userId: string): Promise<string | null>;
  alert(subject: string, lines: string[]): Promise<void>;
}

export const liveLegacyDeleteDeps = (): LegacyDeleteDeps => ({
  ownerRows: async (u) => (await sbRest(`site_owners?user_id=eq.${enc(u)}&select=slug,checkout_session_id&limit=50`)) ?? [],
  legacySites: async (u) => (await sbRest(`sites?user_id=eq.${enc(u)}&site_data->>source=is.null&select=company_name&limit=50`)) ?? [],
  email: (u) => emailOfUser(u),
  alert: alertOwner,
});

export async function alertIfLegacyCustomer(userId: string, deps: LegacyDeleteDeps = liveLegacyDeleteDeps()): Promise<boolean> {
  try {
    const owners = (await deps.ownerRows(userId)).filter((r) => !String(r.checkout_session_id ?? '').startsWith('webapp:'));
    const sites = await deps.legacySites(userId);
    if (!owners.length && !sites.length) return false;
    const email = await deps.email(userId).catch(() => null);
    await deps.alert('Legacy customer deleted their account', [
      `user: ${userId}`,
      `email: ${email ?? '(unknown)'}`,
      `old site slugs (site_owners): ${owners.map((o) => o.slug).join(', ') || '(none)'}`,
      `old sites rows (company names): ${sites.map((s) => s.company_name ?? '(unnamed)').join(', ') || '(none)'}`,
      'Their old Stripe plan was NOT cancelled and their old sites rows go with the account. Cancel the plan by hand.',
    ]);
    return true;
  } catch (e: any) {
    console.error('[ios/delete-account] legacy alert failed (ignored):', e?.message || e);
    return false;
  }
}
