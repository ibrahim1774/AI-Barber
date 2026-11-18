import { describe, expect, it, vi } from 'vitest';
import { recount, type RecountFacts } from '../../lib/account/recount.js';

const NOW = Date.parse('2026-11-18T12:00:00Z');
const FUTURE = new Date(NOW + 30 * 86_400_000).toISOString();
const PAST = new Date(NOW - 30 * 86_400_000).toISOString();
const P = 'com.ibrahim1774.aibarber.hosting.monthly';
const ap = (otid: string, user: string, over: Partial<RecountFacts['apple'][number]> = {}) => ({ original_transaction_id: otid, user_id: user, environment: 'Production', product_id: P, site_slug: null, expires_at: FUTURE, revoked_at: null, taken_down_at: null, ...over });

describe('re-count', () => {
  it('counts the five things per environment, and nothing else', async () => {
    const facts: RecountFacts = {
      now: NOW,
      apple: [
        ap('1', 'mixed', { site_slug: 'a' }),                       // Apple address + web address
        ap('2', 'cardplusapple', { site_slug: 'b' }),               // Apple address + live card plan
        ap('3', 'twolive'), ap('4', 'twolive'),                     // two live purchases
        ap('5', 'lapsed1', { expires_at: PAST }), ap('6', 'lapsed1'), // one live only
        ap('7', 'sbx', { environment: 'Sandbox', site_slug: 'c' }), // a Sandbox row never counts in Production
      ],
      webSites: [{ user_id: 'mixed', environment: 'live', published_at: 'x' }, { user_id: 'webonly', environment: 'live', published_at: 'x' }, { user_id: 'neverpub', environment: 'live', published_at: null }],
      cardPlans: [
        { user_id: 'cardplusapple', environment: 'live', status: 'active' },
        { user_id: 'gone', environment: 'live', status: 'trialing' },
        { user_id: 'canceled', environment: 'live', status: 'canceled' },
        { user_id: 'webonly', environment: 'live', status: 'past_due' },
      ],
      accountExists: vi.fn(async (u: string) => u !== 'gone'),
    };
    const r = await recount(facts);
    expect(r.Production).toEqual({ mixedAccounts: 1, appleTiedToWebAccount: 2, appleAddressAndLiveCardPlan: 1, twoLiveApplePurchases: 1, webPlansWithoutAccount: 1 });
    expect(r.Sandbox).toEqual({ mixedAccounts: 0, appleTiedToWebAccount: 0, appleAddressAndLiveCardPlan: 0, twoLiveApplePurchases: 0, webPlansWithoutAccount: 0 });
    expect(JSON.stringify(r)).not.toMatch(/mixed'|gone|webonly/);
  });
  it('asks about each account once and reads only: facts in, numbers out', async () => {
    const exists = vi.fn(async () => true);
    await recount({ now: NOW, apple: [], webSites: [], cardPlans: [{ user_id: 'a', environment: 'live', status: 'active' }, { user_id: 'a', environment: 'test', status: 'active' }], accountExists: exists });
    expect(exists).toHaveBeenCalledTimes(1);
  });
});
