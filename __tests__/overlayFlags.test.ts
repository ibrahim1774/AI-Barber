import { generateContent } from '@/web/services/geminiService';
import type { WebsiteData } from '@/web/types';
import Storage from 'expo-sqlite/kv-store';
import { startDraft } from '@/lib/flow';
import { clearSite, loadSite, saveSite, type SiteRecord } from '@/lib/siteStore';
import { advanceOverlay, clearOverlayFlags, hasSeen, markSeen, nextOverlay } from '@/lib/overlayFlags';

const site = (over: Partial<WebsiteData> = {}) =>
  generateContent({ shopName: 'Fresh Cuts', area: '', phone: '' }).then((d) => ({ ...d, ...over }));

const record = (data: WebsiteData, over: Partial<SiteRecord> = {}): SiteRecord => ({
  draftId: `draft-${Math.random().toString(36).slice(2)}`,
  inputs: { shopName: data.shopName, area: '', phone: '' },
  data,
  updatedAt: 1,
  slug: null,
  deployedUrl: null,
  transactionId: null,
  ...over,
});

afterEach(() => jest.restoreAllMocks());

describe('nextOverlay (once per draft)', () => {
  test('a name-only site shows prompts, then the guide, then nothing', async () => {
    const r = record(await site());
    expect(await nextOverlay(r)).toBe('prompts');
    await markSeen('prompts', r.draftId);
    expect(await nextOverlay(r)).toBe('guide');
    await markSeen('guide', r.draftId);
    expect(await nextOverlay(r)).toBeNull();
  });

  test('a live site never gets the onboarding, with or without a slug', async () => {
    const d = await site();
    expect(await nextOverlay(record(d, { slug: 'fade', deployedUrl: 'https://fade.vercel.app' }))).toBeNull();
    // Loaded from the account: a URL but no slug.
    expect(await nextOverlay(record(d, { deployedUrl: 'https://fade.vercel.app' }))).toBeNull();
  });

  test('flags are per draft', async () => {
    const d = await site();
    const a = record(d);
    const b = record(d);
    await markSeen('prompts', a.draftId);
    await markSeen('guide', a.draftId);
    expect(await nextOverlay(a)).toBeNull();
    expect(await nextOverlay(b)).toBe('prompts');
  });

  test('an imported site skips the prompts (they would regenerate it) and shows the guide', async () => {
    const r = record(await site(), { inputs: { shopName: 'Fresh Cuts', area: '', phone: '', importedFrom: 'booking' } });
    expect(await nextOverlay(r)).toBe('guide');
    const g = record(await site(), { inputs: { shopName: 'Fresh Cuts', area: '', phone: '', importedFrom: 'gbp' } });
    expect(await nextOverlay(g)).toBe('guide');
  });

  test('a published site shows neither', async () => {
    const r = record(await site(), { slug: 'fresh-cuts', deployedUrl: 'https://fresh-cuts.aibarber.org' });
    expect(await nextOverlay(r)).toBeNull();
  });
});

describe('a new generation resets the flags', () => {
  test('a failed flag reset still saves the draft', async () => {
    await clearSite();
    jest.spyOn(Storage, 'removeItem').mockRejectedValue(new Error('disk full'));
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    const rec = await startDraft({ inputs: { shopName: 'Third Cut', area: '', phone: '' }, site: await site({ shopName: 'Third Cut' }) });
    expect((await loadSite())?.data.shopName).toBe('Third Cut');
    expect(rec.data.shopName).toBe('Third Cut');
  });

  test('clearOverlayFlags shows both overlays again', async () => {
    const r = record(await site());
    await markSeen('prompts', r.draftId);
    await markSeen('guide', r.draftId);
    await clearOverlayFlags(r.draftId);
    expect(await nextOverlay(r)).toBe('prompts');
  });

  test('startDraft over an existing site (same draftId) shows the prompts again', async () => {
    await clearSite();
    const first = record(await site());
    await saveSite(first);
    await markSeen('prompts', first.draftId);
    await markSeen('guide', first.draftId);
    const again = await startDraft({ inputs: { shopName: 'Second Cut', area: '', phone: '' }, site: await site({ shopName: 'Second Cut' }) });
    expect(again.draftId).toBe(first.draftId);
    expect(await nextOverlay(again)).toBe('prompts');
  });
});

describe('advanceOverlay (decided in memory, whatever storage did)', () => {
  test('prompts lead to the guide unless it was already seen; the guide leads to nothing', () => {
    expect(advanceOverlay('prompts', false)).toBe('guide');
    expect(advanceOverlay('prompts', true)).toBeNull();
    expect(advanceOverlay('guide', false)).toBeNull();
    expect(advanceOverlay('guide', true)).toBeNull();
  });

  test('hasSeen reads false when storage throws', async () => {
    jest.spyOn(Storage, 'getItem').mockRejectedValueOnce(new Error('locked'));
    expect(await hasSeen('guide', 'x')).toBe(false);
  });
});
