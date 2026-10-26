import type { WebsiteData } from '@/web/types';
import { buildPreviewHtml } from '@/lib/editable';
import { normalizeBookingLink, normalizePhone } from '@/lib/linkRules';
import { applyButtonChange } from '@/lib/buttonChange';
import { bookingPrefs } from '@/lib/bookingChoice';
import { shop } from '../pagesV2Fixture';

const hrefs = (html: string) => [...html.matchAll(/<a\b[^>]*?\bhref="([^"]*)"/g)].map((m) => m[1].replace(/&amp;/g, '&'));
const rec = (d: WebsiteData): any => ({ draftId: 'd', inputs: { shopName: 'S', area: 'A', phone: '1' }, data: d, updatedAt: 1 });

describe('rendered links: hostile bookingUrl never reaches an href (all designs)', () => {
  const bad = ['javascript:alert(1)', ' JaVaScRiPt:alert(1)', 'data:text/html,<b>', 'vbscript:x', 'file:///etc/passwd', '//evil.com', '/\\evil.com', '/book/../../x', '/bookx', 'blob:https://x'];
  it.each(['luxe', 'prime', 'euphoria'] as const)('%s', async (template) => {
    for (const b of bad) {
      const d = { ...(await shop({ template })), bookingUrl: b } as WebsiteData;
      const all = hrefs(buildPreviewHtml(d, true, null, { key: 'home' } as any));
      for (const h of all) expect(h).not.toMatch(/^\s*(javascript|data|vbscript|file|blob):/i);
      expect(all).not.toContain(b);
      expect(all.some((h) => h.startsWith('//') || h.startsWith('/\\'))).toBe(false);
    }
  });
});

describe('rendered tel: normalisation', () => {
  const telOf = async (template: any, phone: string) => {
    const d = await shop({ template, phone, bookingUrl: undefined } as any);
    delete (d as any).bookingUrl;
    return hrefs(buildPreviewHtml(d, true, null, { key: 'home' } as any)).filter((h) => h.startsWith('tel:'));
  };
  it.each(['luxe', 'euphoria'])('%s: US formats all give the same E.164 digits', async (t) => {
    for (const p of ['(512) 555-0142', '512-555-0142', '512.555.0142', '5125550142', '+1 512 555 0142']) {
      const tels = await telOf(t, p);
      expect(tels.length).toBeGreaterThan(0);
      for (const h of tels) expect(h.replace(/\D/g, '')).toMatch(/^1?5125550142$/);
    }
  });
  it.each(['euphoria'])('%s: a +44 number (accepted by the sheet, 7-15 digits) keeps its country code, not +1', async (t) => {
    expect(normalizePhone('+44 20 7946 0958').ok).toBe(true);
    const tels = await telOf(t, '+44 20 7946 0958');
    for (const h of tels) expect(h.replace(/\D/g, '')).toBe('442079460958');
  });
  it('no phone digits: no tel: link at all', async () => {
    for (const t of ['luxe', 'prime', 'euphoria']) expect(await telOf(t, 'call us')).toEqual([]);
  });
  it('tel: href never carries markup from the phone field', async () => {
    for (const t of ['luxe', 'prime', 'euphoria']) {
      for (const h of await telOf(t, '555 0100"><script>')) expect(h).not.toMatch(/[<>"]/);
    }
  });
});

describe('Book link rules matrix (sheet validator)', () => {
  it.each([
    ['https://booksy.com/x', true], ['booksy.com/x', true], ['HTTPS://X.COM', true], ['https://a.co/p?q=1&r=2#h', true],
    ['https://xn--bcher-kva.example/x', true], ['https://sub.domain.example.com:8443/p', true],
    ['javascript:alert(1)', false], ['  javascript:alert(1)', false], ['java\nscript:alert(1)', false], ['data:text/html;base64,AAA', false],
    ['https://a.com/x y', false], ['https://', false], ['https:///x', false], ['https://a', false], ['https://127.0.0.1', true],
    ['https://[::1]/', false], ['ftp://a.com', false], ['mailto:a@b.co', false], ['tel:5125550142', false], ['sms:5125550142', false],
    ['https://a.com/%0d%0a', true], ['https://a.com\u202e/x', false],
  ])('%j -> ok=%s', (i, ok) => expect(normalizeBookingLink(i as string).ok).toBe(ok));
  it('a link with an RTL override or zero-width char in the host does not pass as a real host (S2 if it does)', () => {
    expect(normalizeBookingLink('https://a.com\u202e/x').ok).toBe(false);
    expect(normalizeBookingLink('https://a\u200b.com/x').ok).toBe(false);
    expect(normalizeBookingLink('https://\u202ea.com/x').ok).toBe(false);
  });
  it('aibarber page links are refused from every spelling', () => {
    for (const u of ['https://www.aibarber.org/book/x', 'https://aibarber.org/book/x', 'aibarber.org/book/x', '/book', '/book/x']) {
      if (normalizeBookingLink(u).ok) throw new Error('accepted ' + u);
    }
  });
});

describe('scheduler vs link saves as ONE record change', () => {
  it('choosing scheduler without touching the link keeps the stored own link', async () => {
    const d = { ...(await shop()), bookingUrl: 'https://booksy.com/x' } as WebsiteData;
    const r = rec(d); r.inputs.ownBookingUrl = 'https://booksy.com/x'; r.inputs.bookingChoice = 'own';
    const out = applyButtonChange(r, 'primeNavBook', { text: 'Book', book: { choice: 'aibarber' } });
    expect(out.inputs.ownBookingUrl).toBe('https://booksy.com/x');
    expect(bookingPrefs(out).choice).toBe('aibarber');
  });
  it('clearing the link (null) while on own removes bookingUrl and remembers the clear', async () => {
    const d = { ...(await shop()), bookingUrl: 'https://booksy.com/x' } as WebsiteData;
    const r = rec(d); r.inputs.bookingChoice = 'own'; r.inputs.ownBookingUrl = 'https://booksy.com/x';
    const out = applyButtonChange(r, 'primeNavBook', { text: 'Book', book: { choice: 'own', url: null } });
    expect(out.data.bookingUrl).toBeUndefined();
    expect(out.inputs.ownBookingCleared).toBe(true);
  });
  it('text-only change leaves phone, address and booking untouched; input record not mutated', async () => {
    const d = await shop(); const r = rec(d); const before = JSON.stringify(r);
    const out = applyButtonChange(r, 'callNow', { text: 'Ring us 📞' });
    expect(out.data.phone).toBe(d.phone); expect(JSON.stringify(r)).toBe(before);
    expect((out.data as any).labels.callNow).toBe('Ring us 📞');
  });
  it('button text with HTML is stored inert in the rendered page', async () => {
    const d = await shop({ template: 'prime' } as any);
    const out = applyButtonChange(rec(d), 'primeNavBook', { text: '<img src=x onerror=alert(1)>' });
    const html = buildPreviewHtml(out.data, false, null, { key: 'home' } as any);
    expect(html).not.toContain('<img src=x onerror');
  });
});

// KNOWN BUG (LANE-B #1): Prime header builds `tel:+1${digits}`, so a phone stored with its country code is dialled wrong.
it.failing('prime: "+1 (512) 555-0199" (accepted by the Call sheet, stored as typed) gives tel:+15125550199', async () => {
  const d: any = await shop({ template: 'prime', phone: '+1 (512) 555-0199' } as any); delete d.bookingUrl;
  const tels = hrefs(buildPreviewHtml(d, true, null, { key: 'home' } as any)).filter((h) => h.startsWith('tel:'));
  expect(tels.length).toBeGreaterThan(0);
  for (const h of tels) expect(h.replace(/\D/g, '')).toBe('15125550199');
});

it.failing('prime: a +44 number keeps its country code, not +1 (LANE-B #1)', async () => {
  const d: any = await shop({ template: 'prime', phone: '+44 20 7946 0958' } as any); delete d.bookingUrl;
  for (const h of hrefs(buildPreviewHtml(d, true, null, { key: 'home' } as any)).filter((x) => x.startsWith('tel:'))) expect(h.replace(/\D/g, '')).toBe('442079460958');
});
