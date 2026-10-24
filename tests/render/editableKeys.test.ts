// Pieces of the editable-everywhere work (2026-10-24): the marker helpers, the data path table and the new label and copy keys.
import { describe, expect, it } from 'vitest';
import { dataPathMax, dataPattern, editableDataPaths } from '../../lib/render/editPaths';
import { mapMarked, printable, unmarked, unwrapMarked } from '../../lib/render/markers';
import { displayPrice, serviceChipName, serviceMeta, teamOf, to12h, firstName, contactEmail, nicheCopy } from '../../lib/render/honest';
import { LABELS, defaultLabel, t } from '../../lib/render/labels';
import { COPY_KEYS, copyBlockInfo, copyDefault, copyHasWordings, copyOverrides, isCopyKey, resolveBlock, lenientEnv, visibleCopyKeys, howOftenRows } from '../../lib/render/guides';
import { renderSiteBundle } from '../../lib/render/site';
import type { WebsiteData } from '../../types';
import { RICH_SITE } from './helpers/richSite';

const M = '⁣';
const wrap = (id: string, v: string) => `${M}${id}${M}${v}${M}/${M}`;

describe('marker helpers', () => {
  it('are the identity on plain text (published data has no markers)', () => {
    expect(mapMarked('Sam', (s) => s.toUpperCase())).toBe('SAM');
    expect(printable('  Sam  ')).toBe('Sam');
    expect(printable(`a${M}b`)).toBe('ab');
    expect(unmarked('Sam')).toBe('Sam');
    expect(unwrapMarked('Sam')).toEqual(['', 'Sam', '']);
  });
  it('keep the wrapper round a reformatted value', () => {
    expect(mapMarked(wrap('a', 'sam'), (s) => s.toUpperCase())).toBe(wrap('a', 'SAM'));
    expect(printable(` ${wrap('a', 'Sam')} `)).toBe(wrap('a', 'Sam'));
    expect(unmarked(wrap('a', 'Sam'))).toBe('Sam');
  });
  it('prices, times, first names and caps reformat the text inside the wrapper', () => {
    expect(displayPrice(wrap('a', '35'))).toBe(wrap('a', '$35'));
    expect(displayPrice('35')).toBe('$35');
    expect(to12h(wrap('b', '17:30'))).toBe(wrap('b', '5:30 PM'));
    expect(to12h('09:00')).toBe('9:00 AM');
    expect(firstName(wrap('c', 'Sam Fade'))).toBe(wrap('c', 'Sam'));
    expect(firstName('Sam Fade')).toBe('Sam');
    expect(serviceMeta({ duration: wrap('d', '30 min'), price: wrap('e', '$30') })).toBe(wrap('d', '30 min'));
    expect(serviceMeta({ subtitle: wrap('d', '30 min · $30'), price: wrap('e', '$30') })).toBe(wrap('d', '30 min'));
    expect(serviceMeta({ subtitle: wrap('d', '$30'), price: wrap('e', '$30') })).toBe('');
  });
  it('a team cap counts the barber\'s text, not the markers', () => {
    const name = 'x'.repeat(80);
    const [card] = teamOf({ staff: [{ name: wrap('a', name), bio: wrap('b', 'y'.repeat(600)) }] });
    expect(card.name).toBe(wrap('a', name));
    expect(card.bio).toBe(wrap('b', 'y'.repeat(600)));
    const [cut] = teamOf({ staff: [{ name: wrap('a', 'x'.repeat(90)) }] });
    expect(cut.name).toBe(wrap('a', 'x'.repeat(80)));
  });
  it('the invented-email check reads the plain text', () => {
    expect(contactEmail({ shopName: wrap('a', 'Fresh Cuts'), contact: { address: '', email: wrap('b', 'contact@freshcuts.com') } })).toBe('');
    expect(contactEmail({ shopName: 'Fresh Cuts', contact: { address: '', email: wrap('b', 'hi@x.co') } })).toBe(wrap('b', 'hi@x.co'));
  });
  it('a service chip is the service title when it is the same text, else the stored name', () => {
    expect(serviceChipName({ services: [{ title: wrap('a', 'Skin Fade') }] }, 'Skin Fade')).toBe(wrap('a', 'Skin Fade'));
    expect(serviceChipName({ services: [{ title: 'Skin Fade' }] }, 'Skin Fade')).toBe('Skin Fade');
    expect(serviceChipName({ services: [{ title: 'Taper' }] }, 'Skin Fade')).toBe('Skin Fade');
  });
});

describe('editable data paths', () => {
  it('expand the arrays of the site and carry the length limits', () => {
    const paths = editableDataPaths(RICH_SITE);
    for (const p of ['shopName', 'services.0.price', 'services.0.duration', 'staff.1.name', 'staff.0.role', 'staff.0.bio', 'hours.3.day', 'hours.0.open', 'staff.0.hours.1.close', 'contact.email', 'bio']) expect(paths, p).toContain(p);
    expect(paths).not.toContain('policy.title'); // Prime only
    expect(editableDataPaths({ ...RICH_SITE, template: 'prime' } as WebsiteData)).toContain('policy.title');
    expect(dataPattern('staff.2.hours.3.open')).toBe('staff.{i}.hours.{j}.open');
    expect(dataPathMax('staff.0.name')).toBe(80);
    expect(dataPathMax('staff.0.bio')).toBe(600);
    expect(dataPathMax('shopName')).toBeUndefined();
  });
  it('skip fields the site does not have', () => {
    const paths = editableDataPaths({ ...RICH_SITE, staff: undefined, hours: undefined } as WebsiteData);
    expect(paths.some((p) => p.startsWith('staff.') || p.startsWith('hours.'))).toBe(false);
  });
});

describe('new labels keep today\'s wording', () => {
  it('defaults', () => {
    expect(defaultLabel('pgInPlace')).toBe('Barbershop in');
    expect(defaultLabel('shopStripHeading')).toBe('Shop');
    expect(defaultLabel('shopStripLink')).toBe('See all');
    expect(defaultLabel('primeGalleryNote')).toBe('Real cuts from inside the shop — no stock photos.');
    expect(defaultLabel('primePullQuote')).toBe(nicheCopy({}).pullQuote);
    expect(t(undefined, 'primePullQuote')).toContain('&#39;'); // escaped like escapeHtml
  });
  it('every new label has a limit', () => {
    for (const k of ['pgInPlace', 'shopStripHeading', 'shopStripLink', 'primeGalleryNote', 'primePullQuote'] as const) expect(LABELS[k].max).toBeGreaterThan(0);
  });
});

describe('FAQ questions and Hair care lines are copy keys', () => {
  const d = RICH_SITE;
  it('are in the closed set with their limits', () => {
    expect(isCopyKey('faq.book.q')).toBe(true);
    expect(isCopyKey('guide.fade.interval')).toBe(true);
    expect(isCopyKey('guide.shave.interval')).toBe(false);
    expect(copyBlockInfo('faq.book.q')).toMatchObject({ kind: 'p', max: 160 });
    expect(copyBlockInfo('guide.fade.interval')?.max).toBe(200);
    expect(COPY_KEYS.filter((k) => k.endsWith('.q')).length).toBeGreaterThanOrEqual(14);
    expect(copyHasWordings('faq.book.q')).toBe(false);
    expect(copyHasWordings('faq.book')).toBe(true);
    expect(copyHasWordings('guide.fade.interval')).toBe(true);
  });
  it('have defaults for the editor: the question, and the sentence of the first service of that kind', () => {
    expect(copyDefault(d, 'faq.book.q')).toBe('How do I book?');
    expect(copyDefault(d, 'guide.fade.interval')).toMatch(/fade/i);
    expect(copyDefault({ ...d, services: [] } as WebsiteData, 'guide.fade.interval')).toBe('');
  });
  it('are listed on the page that prints them (and not when the section is hidden)', () => {
    const faq = visibleCopyKeys(d, { key: 'faq' });
    expect(faq).toContain('faq.book.q');
    expect(faq.indexOf('faq.book.q')).toBeLessThan(faq.indexOf('faq.book'));
    expect(visibleCopyKeys(d, { key: 'hair-care' })).toContain('guide.fade.interval');
    const hidden = { ...d, pageSections: { faq: { hidden: ['book'] }, 'hair-care': { hidden: ['often'] } } } as WebsiteData;
    expect(visibleCopyKeys(hidden, { key: 'faq' })).not.toContain('faq.book.q');
    expect(visibleCopyKeys(hidden, { key: 'faq' })).not.toContain('faq.book');
    expect(visibleCopyKeys(hidden, { key: 'hair-care' })).not.toContain('guide.fade.interval');
  });
  it('an edited question and an edited Hair care sentence reach the pages, and the answer keeps its own text', () => {
    const edited = { ...d, copy: { 'faq.book.q': 'Can I book by text?', 'guide.fade.interval': 'Come back every two weeks.' } } as WebsiteData;
    const files = Object.fromEntries(renderSiteBundle(edited, { siteBaseUrl: 'https://x.example.com' }).pages.map((p) => [p.path, p.html]));
    expect(files['faq/index.html']).toContain('Can I book by text?');
    expect(files['faq/index.html']).not.toContain('How do I book?');
    expect(files['faq/index.html']).toContain('To book, use the');
    expect(files['hair-care/index.html']).toContain('Skin Fade</a>: Come back every two weeks.');
  });
  it('the question and the sentence are not blocks and do not resolve', () => {
    expect(resolveBlock(lenientEnv(d), 'faq.book.q')).toBeNull();
    expect(howOftenRows(lenientEnv(d)).length).toBeGreaterThan(0);
  });
  it('a barber\'s question is capped like every override', () => {
    const long = 'q'.repeat(400);
    expect(Array.from(copyOverrides({ copy: { 'faq.book.q': long } }).get('faq.book.q')!).length).toBe(160);
  });
});
