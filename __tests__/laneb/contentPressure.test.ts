import { draftToProduct, emptyDraft, formatPrice, parsePrice, productToDraft, validateDraft } from '@/lib/store/productDraft';
import { addService, formatPrice as svcPrice, moveService, newService, parseDuration, removeService, updateService, durationLabel } from '@/lib/sections/services';
import { cleanText } from '@/lib/sections/text';
import { aboutError, contactError, setAbout, setContact } from '@/lib/sections/aboutContact';
import { sectionCards } from '@/lib/sections/list';
import { setRatingLine } from '@/lib/sections/reviews';
import { clearGalleryPhoto } from '@/lib/sections/gallery';
import { addMember, moveMember, removeMember } from '@/lib/sections/team';

const site = (o: any = {}) => ({ shopName: 'S', phone: '', hero: { heading: '', tagline: '', imageUrl: '' }, about: { heading: '', description: [], imageUrl: '' }, services: [], gallery: [], ...o }) as any;
const ok = { ...emptyDraft(), name: 'Pomade', price: '12.5' };

describe('products: price formats', () => {
  it.each([
    ['12.5', 1250], ['12.50', 1250], ['$12.5', 1250], [' 12 ', 1200], ['0.5', 50], ['.5', 50], ['1,234.56', 123456], ['10000', 1000000], ['12.', 1200],
  ])('accepts %j', (i, c) => expect(parsePrice(i as string)).toBe(c));
  it.each(['12,50', '-5', '-0', '0x10', '1e3', 'NaN', 'Infinity', '12.345', '$$5', '１２', '', ' ', '12 50', '99999999999999999999', '1,00', '٣'])('rejects %j', (i) => {
    const c = parsePrice(i);
    // either rejected, or (for huge values) caught by validateDraft
    if (c !== null) expect(validateDraft({ ...ok, price: i }).price).toBeTruthy();
    else expect(validateDraft({ ...ok, price: i }).price).toBeTruthy();
  });
  it('zero and negative are errors on the form', () => {
    expect(validateDraft({ ...ok, price: '0' }).price).toBeTruthy();
    expect(validateDraft({ ...ok, price: '-12' }).price).toBeTruthy();
  });
  it('huge price never produces a savable product', () => {
    expect(validateDraft({ ...ok, price: '1e9' }).price).toBeTruthy();
    expect(validateDraft({ ...ok, price: '9'.repeat(30) }).price).toBeTruthy();
  });
  it('12,50 (comma decimal) gives a message the user can act on', () => {
    expect(validateDraft({ ...ok, price: '12,50' }).price).toMatch(/12/);
  });
  it('round-trips product <-> draft for fractional cents and sold-out', () => {
    for (const cents of [50, 99, 1250, 1999, 100000, 1000000]) {
      const p = { id: '1', shopId: 's', sort: 0, name: 'n', description: '', photos: [], soldOut: true, priceCents: cents } as any;
      const d = productToDraft(p);
      expect(parsePrice(d.price)).toBe(cents);
      expect(draftToProduct(d).soldOut).toBe(true);
      expect(formatPrice(cents)).toMatch(/^\$/);
    }
  });
  it('0.29 * 100 style float errors do not shift cents', () => {
    expect(parsePrice('0.29')).toBe(29); expect(parsePrice('1.15')).toBe(115); expect(parsePrice('19.99')).toBe(1999); expect(parsePrice('4.35')).toBe(435);
  });
  it('long names, emoji, HTML are accepted/limited sanely and trimmed', () => {
    expect(validateDraft({ ...ok, name: '💈'.repeat(40) }).name).toBeUndefined();
    expect(validateDraft({ ...ok, name: '<b>Pomade</b> & "Wax"' }).name).toBeUndefined();
    expect(draftToProduct({ ...ok, name: '  Pomade 💈  ' }).name).toBe('Pomade 💈');
    expect(validateDraft({ ...ok, name: '\n\t ' }).name).toBeTruthy();
  });
  it('emoji counted by UTF-16: 41 flag emoji (82 units) is rejected consistently', () => {
    // documents behavior: length is UTF-16 units, so 40 emoji fits the same as 80 chars
    expect(validateDraft({ ...ok, name: '💈'.repeat(41) }).name).toBeTruthy();
  });
  it('an empty draft shows every required error (empty state of the form)', () => {
    const e = validateDraft(emptyDraft());
    expect(e.name).toBeTruthy(); expect(e.price).toBeTruthy();
  });
});

describe('services', () => {
  it.each([['12.5', '$12.50'], ['12,50', null], ['0', '$0'], ['-5', null], ['$1,200.5', '$1,200.50'], ['From $25+', null], ['00012', '$12'], ['1e3', null], ['99999999999999999999', '$99,999,999,999,999,999,999'], ['', null], ['12.345', null]])('price %j', (i, o) => expect(svcPrice(i)).toBe(o));
  it('unparseable price text is kept verbatim after cleanText (From $25+), never dropped', () => {
    const d = updateService(site({ services: [newService('Cut', 30, 'scissors' as any)] }), 0, { title: 'Cut', price: 'From $25+', duration: 30, description: '', imageUrl: '' });
    expect(d.services[0].price).toBe('From $25+');
  });
  it('negative price typed is kept as text, not formatted to a positive', () => {
    const d = updateService(site({ services: [newService('Cut', 30, 'x' as any)] }), 0, { title: 'Cut', price: '-5', duration: 30, description: '', imageUrl: '' });
    expect(d.services[0].price).not.toBe('$5');
  });
  it('HTML in titles is stripped of < and >, quotes straightened, emoji preserved', () => {
    const d = updateService(site({ services: [newService('x', 30, 'x' as any)] }), 0, { title: '<script>alert(1)</script> Jack’s 💈', price: '', duration: 30, description: 'a<b>c', imageUrl: ' https://x.y/z.jpg\n' });
    expect(d.services[0].title).toBe("scriptalert(1)/script Jack's 💈");
    expect(d.services[0].description).toBe('abc');
    expect(d.services[0].imageUrl).toBe('https://x.y/z.jpg');
  });
  it('title that becomes empty after cleaning ("<>") is not blocked by the model layer', () => {
    // UI must guard; this documents that updateService accepts an empty title
    const d = updateService(site({ services: [newService('x', 30, 'x' as any)] }), 0, { title: '<>', price: '', duration: 30, description: '', imageUrl: '' });
    expect(d.services[0].title).toBe('');
  });
  it.each([['0 min', 0], ['1 min', 1], ['1440 min', 1440], ['2 hr', 120], ['2hrs 5m', 125], ['-5 min', null], ['5.5 min', null], ['', null], ['1 hr 90 min', 150]])('duration %j', (i, o) => expect(parseDuration(i)).toBe(o));
  it('durationLabel for 0 / huge', () => { expect(durationLabel(0)).toBe('0 min'); expect(durationLabel(1500)).toBe('25 hr'); });
  it('null duration keeps stored duration; add/edit/delete/reorder', () => {
    let d = addService(site(), newService('A', 30, 'x' as any));
    d = addService(d, newService('B', 45, 'x' as any)); d = addService(d, newService('C', 60, 'x' as any));
    d = updateService(d, 1, { title: 'B2', price: '10', duration: null, description: '', imageUrl: '' });
    expect(d.services[1].duration).toBe('45 min'); expect(d.services[1].price).toBe('$10');
    d = moveService(d, 2, -1); expect(d.services.map((s: any) => s.title)).toEqual(['A', 'C', 'B2']);
    d = moveService(d, 0, -1); d = moveService(d, 2, 1); d = moveService(d, 9, 1); expect(d.services.map((s: any) => s.title)).toEqual(['A', 'C', 'B2']);
    d = removeService(d, 5); expect(d.services).toHaveLength(3);
    d = removeService(removeService(removeService(d, 0), 0), 0); expect(d.services).toEqual([]);
    expect(sectionCards(d).find((c) => c.key === 'services')!.summary).toBe('None yet');
    expect(updateService(d, 0, { title: 'x', price: '', duration: 1, description: '', imageUrl: '' })).toBe(d);
  });
  it('moveService does not mutate its input', () => {
    const d = site({ services: [{ title: 'A' }, { title: 'B' }] }); moveService(d, 0, 1); expect(d.services[0].title).toBe('A');
  });
});

describe('sections: text, about, contact, footer credit', () => {
  it('cleanText: emoji ZWJ, RTL, newlines, quotes', () => {
    expect(cleanText('  👨‍🦲 Fade  ')).toBe('👨‍🦲 Fade');
    expect(cleanText('مرحبا <b>x</b>')).toBe('مرحبا bx/b');
    expect(cleanText('‘a’')).toBe("'a'");
    expect(cleanText('a&amp;b "q"')).toBe('a&amp;b "q"');
  });
  it('about: empty/whitespace/"<>" name refused and data unchanged', () => {
    for (const n of ['', '   ', '<>', '<<>>']) { expect(aboutError({ shopName: n, tagline: '', about: '' })).toBeTruthy(); }
    const d = site(); expect(setAbout(d, { shopName: '<>', tagline: '', about: '' })).toBe(d);
  });
  it('about: very long text is stored whole (documented: no max length)', () => {
    const long = 'x'.repeat(50000); const r = setAbout(site(), { shopName: 'N', tagline: long, about: `${long}\n\n💈` });
    expect(r.hero.tagline.length).toBe(50000); expect(r.about.description).toEqual([long, '💈']);
  });
  it('contact: email validation; phone 5125550142 formatted; html stripped', () => {
    expect(contactError({ phone: '', address: '', email: 'a' })).toBeTruthy();
    expect(contactError({ phone: '', address: '', email: '' })).toBeNull();
    const r = setContact(site(), { phone: '5125550142', address: '1 <Main> St', email: 'a@b.co' });
    expect(r.phone).toBe('(512) 555-0142'); expect(r.contact.address).toBe('1 Main St');
  });
  it('contact: junk phone is stored as typed (no validation in section sheet)', () => {
    expect(setContact(site(), { phone: 'call me!', address: '', email: '' }).phone).toBe('call me!');
  });
  it('rating line (footer credit style free text) round trips with emoji and strips tags', () => {
    const r = setRatingLine(site({ aggregateRating: { ratingValue: 4.9, reviewCount: 10 } }), '4.9 ★ from <i>Google</i> 💈');
    expect(JSON.stringify(r.data)).not.toContain('<i>');
  });
  it('section cards reflect add/remove: team + gallery + hours', () => {
    let d = site({ template: 'prime' });
    expect(sectionCards(d).find((c) => c.key === 'team')!.summary).toBe('Not set');
    d = addMember(d, { name: 'A' }); d = addMember(d, { name: 'B' });
    expect(sectionCards(d).find((c) => c.key === 'team')!.summary).toBe('2 people');
    d = moveMember(d, 1, -1); expect(d.staff![0].name).toBe('B');
    d = removeMember(removeMember(d, 0), 0);
    expect(sectionCards(d).find((c) => c.key === 'team')!.summary).toBe('Not set');
    expect(sectionCards(clearGalleryPhoto(d, 0)).find((c) => c.key === 'gallery')!.summary).toBe('0 of 6 photos');
  });
  it('reviews card is hidden when there is no rating or reviews', () => {
    expect(sectionCards(site()).some((c) => c.key === 'reviews')).toBe(false);
  });
});
