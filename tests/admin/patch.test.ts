import { describe, it, expect } from 'vitest';
import {
  applyPatch, applySets, getPath, parseHours, parseServices, PatchError, quickFieldsOf, quickFieldsPatch, setPath,
} from '../../lib/admin/patch.js';

const sd = () => ({
  shopName: 'Fade Lab',
  phone: '555-0100',
  area: 'Austin',
  contact: { address: '1 Main St', email: 'a@b.co' },
  hero: { heading: 'H', tagline: 'T', imageUrl: 'https://h' },
  about: { heading: 'About', description: ['One.', 'Two.'], imageUrl: '' },
  services: [
    { title: 'Fade', subtitle: 's', description: 'd', icon: 'razor', imageUrl: '', price: '$30', duration: '30 min' },
    { title: 'Beard', subtitle: '', description: '', icon: 'mustache', imageUrl: '' },
  ],
  gallery: [],
  hours: [{ day: 'Mon', open: '9:00 AM', close: '6:00 PM' }, { day: 'Sun', open: '', close: '', closed: true }],
  bookingUrl: 'https://booksy.com/x',
  template: 'prime',
});

describe('setPath / getPath', () => {
  it('sets nested object and array paths without mutating the input', () => {
    const a = sd();
    const b: any = setPath(a, 'services.0.price', '$35');
    expect(b.services[0].price).toBe('$35');
    expect(a.services[0].price).toBe('$30');
    expect(getPath(setPath(a, 'contact.address', '2 Oak'), 'contact.address')).toBe('2 Oak');
  });
  it('creates missing containers (array for numeric next segment) and can append at length', () => {
    const b: any = setPath({}, 'labels.galleryHeading', 'Work');
    expect(b.labels).toEqual({ galleryHeading: 'Work' });
    const c: any = setPath(sd(), 'gallery.0', 'https://g0');
    expect(c.gallery).toEqual(['https://g0']);
  });
  it('undefined removes', () => {
    expect((setPath(sd(), 'bookingUrl', undefined) as any).bookingUrl).toBeUndefined();
  });
  it('rejects prototype paths, gaps and wrong container types', () => {
    expect(() => setPath({}, '__proto__.x', 1)).toThrow(PatchError);
    expect(() => setPath({}, 'a..b', 1)).toThrow(PatchError);
    expect(() => setPath(sd(), 'services.5.title', 'x')).toThrow(/past the end/);
    expect(() => setPath(sd(), 'services.name', 'x')).toThrow(/is a list/);
    expect(() => setPath(sd(), 'phone.x', 'x')).toThrow(/not an object/);
  });
});

describe('applyPatch / applySets', () => {
  it('merges objects, replaces arrays, null deletes', () => {
    const out: any = applyPatch(sd(), { contact: { address: '9 Elm' }, gallery: ['https://g'], bookingUrl: null });
    expect(out.contact).toEqual({ address: '9 Elm', email: 'a@b.co' });
    expect(out.gallery).toEqual(['https://g']);
    expect('bookingUrl' in out).toBe(false);
  });
  it('rejects non-object patches and forbidden keys', () => {
    expect(() => applyPatch(sd(), [] as any)).toThrow(PatchError);
    expect(() => applyPatch(sd(), JSON.parse('{"__proto__":{"x":1}}'))).toThrow(PatchError);
  });
  it('applySets applies each path in order; empty is an error', () => {
    const out: any = applySets(sd(), { phone: '555-9999', 'hours.0.open': '10:00 AM' });
    expect(out.phone).toBe('555-9999');
    expect(out.hours[0].open).toBe('10:00 AM');
    expect(() => applySets(sd(), {})).toThrow(PatchError);
  });
});

describe('quick fields', () => {
  it('round-trips a stored site to text', () => {
    const q = quickFieldsOf(sd());
    expect(q.hours).toBe('Mon | 9:00 AM | 6:00 PM\nSun | closed');
    expect(q.services).toBe('Fade | $30 | 30 min\nBeard');
    expect(q.about).toBe('One.\n\nTwo.');
    expect(q.address).toBe('1 Main St');
    expect(quickFieldsPatch(sd(), q)).toEqual({});
  });

  it('builds a patch with only the changed fields', () => {
    const q = quickFieldsOf(sd());
    const patch = quickFieldsPatch(sd(), {
      ...q,
      phone: ' 555-2222 ',
      address: '2 Oak Ave',
      hours: 'Mon | 10:00 AM | 7:00 PM\nSun | closed',
      services: 'Fade | $35 | 30 min\nBeard | $15\nLineup | $10',
      about: 'New text.',
      bookingUrl: '',
      template: 'luxe',
    });
    expect(patch).toEqual({
      phone: '555-2222',
      contact: { address: '2 Oak Ave', email: 'a@b.co' },
      hours: [{ day: 'Mon', open: '10:00 AM', close: '7:00 PM' }, { day: 'Sun', open: '', close: '', closed: true }],
      services: [
        { title: 'Fade', subtitle: 's', description: 'd', icon: 'razor', imageUrl: '', price: '$35', duration: '30 min' },
        { title: 'Beard', subtitle: '', description: '', icon: 'mustache', imageUrl: '', price: '$15' },
        { title: 'Lineup', subtitle: '', description: '', icon: 'scissors', imageUrl: '', price: '$10' },
      ],
      about: { description: ['New text.'] },
      bookingUrl: null,
      template: 'luxe',
    });
  });

  it('rejects bad hours, empty shop name and unknown templates', () => {
    const q = quickFieldsOf(sd());
    expect(() => quickFieldsPatch(sd(), { ...q, hours: 'Mon | 9' })).toThrow(PatchError);
    expect(() => quickFieldsPatch(sd(), { ...q, shopName: ' ' })).toThrow(/cannot be empty/);
    expect(() => quickFieldsPatch(sd(), { ...q, template: 'neon' })).toThrow(/template/);
  });

  it('parseHours / parseServices edge cases', () => {
    expect(parseHours('\n  \n')).toEqual([]);
    expect(parseServices('Cut', [])).toEqual([{ title: 'Cut', subtitle: '', description: '', icon: 'scissors', imageUrl: '' }]);
  });
});
