// Goldens for a full multi-page site (pages pages v2, Phase B): one file per page type, per design. Regenerate with
// UPDATE_GOLDEN=1 npx vitest run tests/render/multiFullGolden.test.ts after an intended change of wording or markup.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderSiteBundle } from '../../lib/render/site';
import type { WebsiteData } from '../../types';

const FIXTURE = join(__dirname, 'fixtures/multi-full.json');
beforeAll(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2031-06-01T12:00:00Z')); });
afterAll(() => { vi.useRealTimers(); });

const svc = (title: string, extra: Record<string, unknown> = {}) => ({ title, subtitle: '', description: '', icon: 'scissors' as const, imageUrl: '', ...extra });
const site: WebsiteData = {
  shopName: 'Fresh Cuts', area: 'Brooklyn, NY', phone: '(512) 555-0100', bookingUrl: '/book', template: 'luxe',
  hero: { heading: 'Fresh Cuts', tagline: '', imageUrl: '' },
  about: { heading: 'About', description: [], imageUrl: '' },
  services: [svc('Skin Fade', { price: '$35', duration: '45 min' }), svc('Taper', { price: '$30' }), svc('Beard Trim', { price: '$15' }), svc('Kids Cut', { price: '$20' }), svc('Hot Towel Shave', { price: '$30' }), svc('Facial')],
  gallery: [], hours: [{ day: 'Mon', open: '09:00', close: '17:00' }, { day: 'Tue', open: '09:00', close: '17:00' }, { day: 'Sun', open: '', close: '', closed: true }],
  contact: { address: '1 Main St, Brooklyn, NY 11201', email: '' },
  pages: { order: [], hidden: [] },
  extraPages: { on: ['faq', 'first-visit', 'hair-care', 'beard-care'], serviceGuides: true, seed: 11 },
} as WebsiteData;

const render = () => Object.fromEntries(['luxe', 'prime', 'euphoria'].map((t) => [t, Object.fromEntries(
  renderSiteBundle({ ...site, template: t as 'luxe' }, { siteBaseUrl: 'https://fresh.example.com' }).pages.map((p) => [p.path, p.html.replace(/published-at" content="\d+"/, '')]),
)]));

describe('multi-page goldens', () => {
  let golden = {} as Record<string, Record<string, string>>;
  beforeAll(() => {
    if (process.env.UPDATE_GOLDEN || !existsSync(FIXTURE)) writeFileSync(FIXTURE, JSON.stringify(render(), null, 1));
    golden = JSON.parse(readFileSync(FIXTURE, 'utf8'));
  });
  it.each(['luxe', 'prime', 'euphoria'])('%s: every page of the full site is byte-identical to its golden', (t) => {
    const now = render()[t];
    expect(Object.keys(now)).toEqual(Object.keys(golden[t]));
    for (const path of Object.keys(now)) expect(now[path], `${t} ${path}`).toBe(golden[t][path]);
  });
  it('the fixture covers one file per page type', () => {
    for (const p of ['index.html', 'services/index.html', 'services/skin-fade/index.html', 'location/index.html', 'hours/index.html', 'contact/index.html', 'faq/index.html', 'first-visit/index.html', 'hair-care/index.html', 'beard-care/index.html']) expect(Object.keys(golden.luxe)).toContain(p);
  });
});
