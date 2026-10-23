import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { generateHTMLWithPlaceholders } from '../../lib/render/luxe';
import { generatePrimeHTMLWithPlaceholders } from '../../lib/render/prime';
import { generateEuphoriaHTMLWithPlaceholders } from '../../lib/render/euphoria';
import { teamBookLink, teamOf, TEAM_DISPLAY_CAP } from '../../lib/render/honest';
import { LABELS, visibleLabelKeys } from '../../lib/render/labels';
import type { TeamMember, WebsiteData } from '../../types';

const MID = '3f2b8c1e-4a5d-4e6f-8a9b-0c1d2e3f4a5b';
const fixture = (extra: Partial<WebsiteData> = {}): WebsiteData => ({
  shopName: 'Fresh Cuts Barbershop', area: 'Austin, TX', phone: '(512) 555-0100',
  hero: { heading: 'Sharp cuts', tagline: 'Walk-ins welcome', imageUrl: '' },
  about: { heading: 'About', description: ['Family owned.'], imageUrl: '' },
  services: [{ title: 'Haircut', subtitle: '$30', description: 'Classic cut', icon: 'scissors', imageUrl: '' }],
  gallery: [], contact: { address: '1 Main St, Austin, TX', email: 'hi@example.com' },
  ...extra,
});
const TEMPLATES = [
  ['luxe', generateHTMLWithPlaceholders],
  ['prime', generatePrimeHTMLWithPlaceholders],
  ['euphoria', generateEuphoriaHTMLWithPlaceholders],
] as const;
const sam: TeamMember = { id: 's1', name: 'Sam Fade', role: 'Owner & master barber', photo: 'has-image', bio: 'Skin fades and beard work.', memberId: MID, serviceNames: ['Haircut', 'Beard trim', 'Hot towel', 'Kids cut'] };

beforeAll(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-01-01T00:00:00Z')); });
afterAll(() => { vi.useRealTimers(); });

describe.each(TEMPLATES)('%s team section', (name, render) => {
  it('renders a card per member with photo slot, role, bio, 3 chips and "Book with Sam"', () => {
    const html = render(fixture({ bookingUrl: '/book', staff: [sam, { name: 'Jay Cut' }] }));
    expect(html).toContain('{{staff0}}');
    expect(html).not.toContain('{{staff1}}'); // no photo
    expect(html).toContain('Sam Fade');
    expect(html).toContain('Owner &amp; master barber');
    expect(html).toContain('Skin fades and beard work.');
    expect(html).toContain('Haircut');
    expect(html).toContain('Hot towel');
    expect(html).not.toContain('Kids cut'); // chips are capped at 3
    expect(html).toContain(`href="/book?barber=${MID}"`);
    expect(html).toContain('Book with Sam');
    expect(html).toContain('id="team-sam-fade"');
  });

  it('snapshot', () => {
    expect(render(fixture({ bookingUrl: '/book', staff: [sam, { name: 'Jay Cut', role: 'Barber', bookingUrl: 'https://cal.example.com/jay' }] }))).toMatchSnapshot();
  });

  it('no staff, no team section', () => {
    expect(render(fixture())).not.toContain('id="team"');
    expect(render(fixture({ staff: [] }))).not.toContain('id="team"');
  });

  it('escapes everything, drops script/javascript links', () => {
    const html = render(fixture({
      bookingUrl: 'https://booksy.com/x',
      staff: [{ name: '<script>alert(1)</script>', role: '"><img src=x onerror=1>', bio: '<b>hi</b>', serviceNames: ['<i>x</i>'], bookingUrl: 'javascript:alert(1)', memberId: 'x"><script>' }],
    }));
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<b>hi</b>');
    expect(html).not.toContain('<i>x</i>');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('stored staff longer than 5 is not cut; only 5 render', () => {
    const staff = Array.from({ length: 8 }, (_, i) => ({ name: `Barber${i}`, photo: 'has-image' }));
    const data = fixture({ staff });
    const html = render(data);
    expect(data.staff).toHaveLength(8);
    for (let i = 0; i < TEAM_DISPLAY_CAP; i++) expect(html).toContain(`Barber${i}`);
    expect(html).not.toContain('Barber5');
    expect(html).toContain('{{staff4}}');
    expect(html).not.toContain('{{staff5}}');
  });

  it('labels: teamBookWith, and the design\'s team heading, are overridable and escaped', () => {
    const html = render(fixture({ bookingUrl: '/book', staff: [sam], labels: { teamBookWith: 'Reserve <b>with</b>' } as any }));
    expect(html).toContain('Reserve &lt;b&gt;with&lt;/b&gt; Sam');
  });
});

describe('Book button rule table', () => {
  const pick = (site: Partial<WebsiteData>, m: Partial<TeamMember>) => {
    const full = fixture({ staff: [{ name: 'Sam', ...m }], ...site });
    const [card] = teamOf(full);
    return teamBookLink(full, card, /^\/book(?=[?#]|$)/.test(full.bookingUrl ?? ''));
  };
  it('1. live AI booking + UUID memberId -> /book?barber=<id>, same tab', () => {
    expect(pick({ bookingUrl: '/book' }, { memberId: MID, bookingUrl: 'https://own.example.com' })).toEqual({ href: `/book?barber=${MID}`, newTab: false });
  });
  it('1b. live booking but memberId is not a UUID -> member link', () => {
    expect(pick({ bookingUrl: '/book' }, { memberId: 'not-a-uuid', bookingUrl: 'https://own.example.com/x' })).toEqual({ href: 'https://own.example.com/x', newTab: true });
    expect(pick({ bookingUrl: '/book' }, { memberId: '../x?y=1' })).toEqual({ href: '/book', newTab: false });
  });
  it('1c. booking not live (external shop link) ignores memberId', () => {
    expect(pick({ bookingUrl: 'https://booksy.com/shop' }, { memberId: MID })).toEqual({ href: 'https://booksy.com/shop', newTab: true });
  });
  it('2. else the member bookingUrl, new tab', () => {
    expect(pick({ bookingUrl: 'https://booksy.com/shop' }, { bookingUrl: 'https://cal.example.com/sam' })).toEqual({ href: 'https://cal.example.com/sam', newTab: true });
    expect(pick({}, { bookingUrl: 'http://cal.example.com/sam' })).toEqual({ href: 'http://cal.example.com/sam', newTab: true });
  });
  it('2b. unsafe or relative member links are ignored (javascript:, data:, /shop)', () => {
    for (const u of ['javascript:alert(1)', 'data:text/html,x', '/shop', '/book', 'ftp://x.co', '//evil.com']) {
      expect(pick({ bookingUrl: 'https://booksy.com/shop' }, { bookingUrl: u })).toEqual({ href: 'https://booksy.com/shop', newTab: true });
    }
  });
  it('3. else the shop booking link', () => {
    expect(pick({ bookingUrl: 'https://booksy.com/shop' }, {})).toEqual({ href: 'https://booksy.com/shop', newTab: true });
  });
  it('4. else no button', () => {
    expect(pick({}, {})).toBeNull();
    expect(pick({ bookingUrl: 'javascript:alert(1)' }, {})).toBeNull();
  });
  it.each(TEMPLATES)('%s html: new-tab links carry noopener, the encoded id is the whole query', (_n, render) => {
    const html = render(fixture({ bookingUrl: 'https://booksy.com/shop', staff: [{ name: 'Sam', bookingUrl: 'https://cal.example.com/sam' }] }));
    expect(html).toMatch(/href="https:\/\/cal\.example\.com\/sam" target="_blank" rel="noopener noreferrer"/);
    const live = render(fixture({ bookingUrl: '/book', staff: [{ name: 'Sam', memberId: MID.toUpperCase() }] }));
    expect(live).toContain(`href="/book?barber=${MID.toUpperCase()}"`);
  });
});

describe('teamOf', () => {
  it('skips nameless/garbage entries, keeps stored indices, never mutates', () => {
    const staff: any[] = [null, { name: '  ' }, { name: 'A', photo: 'has-image' }, 'x', { name: 'B', photo: 'has-image' }];
    const copy = JSON.stringify(staff);
    const team = teamOf({ staff });
    expect(team.map((m) => [m.name, m.index])).toEqual([['A', 2], ['B', 4]]);
    expect(JSON.stringify(staff)).toBe(copy);
  });
  it('unique slugs for duplicate names', () => {
    expect(teamOf({ staff: [{ name: 'Sam' }, { name: 'Sam' }] }).map((m) => m.slug)).toEqual(['sam', 'sam-2']);
  });
  it('old {name, role, photo} staff still works', () => {
    expect(teamOf({ staff: [{ name: 'Old', role: 'Barber', photo: 'x' }] })[0]).toMatchObject({ name: 'Old', role: 'Barber', photo: 'x', index: 0 });
  });
});

describe('label registry', () => {
  it('has the new keys with defaults, shown only with a team', () => {
    for (const k of ['primeTeamEyebrow', 'primeTeamHeading', 'euTeamEyebrow', 'euTeamHeading', 'teamBookWith'] as const) expect(LABELS[k]).toBeDefined();
    expect(LABELS.teamBookWith.default).toBe('Book with');
    expect(visibleLabelKeys(fixture({ template: 'prime', staff: [sam] })).filter((k) => /Team|teamBook/.test(k)).sort()).toEqual(['primeTeamEyebrow', 'primeTeamHeading', 'teamBookWith']);
    expect(visibleLabelKeys(fixture({ template: 'prime' })).filter((k) => /Team|teamBook/.test(k))).toEqual([]);
  });
});
