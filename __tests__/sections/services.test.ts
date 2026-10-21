import type { WebsiteData } from '@/web/types';
import {
  SERVICE_LIBRARY, addService, durationLabel, formatPrice, moveService, newService,
  parseDuration, removeService, updateService,
} from '@/lib/sections/services';

const base = (services: any[] = []): WebsiteData => ({
  shopName: 'S', area: '', phone: '', hero: { heading: '', tagline: '', imageUrl: '' },
  about: { heading: '', description: [], imageUrl: '' }, services, gallery: [],
} as unknown as WebsiteData);
const draft = (o: Partial<Parameters<typeof updateService>[2]> = {}) =>
  ({ title: 'Fade', price: '', duration: 30, description: '', imageUrl: '', ...o });

describe('formatPrice', () => {
  it.each([['30', '$30'], ['$25.5', '$25.50'], ['1,200', '$1,200'], ['', null], ['abc', null], ['$30+', null]])(
    '%s', (i, o) => expect(formatPrice(i)).toBe(o));
});
describe('durations', () => {
  it('labels', () => {
    expect(durationLabel(15)).toBe('15 min');
    expect(durationLabel(60)).toBe('1 hr');
    expect(durationLabel(90)).toBe('1 hr 30 min');
  });
  it('parses', () => {
    expect(parseDuration('45 min')).toBe(45);
    expect(parseDuration('1 hr 30 min')).toBe(90);
    expect(parseDuration('about an hour')).toBeNull();
    expect(parseDuration(undefined)).toBeNull();
  });
});
describe('SERVICE_LIBRARY', () => {
  it('has the groups and items', () => {
    expect(SERVICE_LIBRARY.map((g) => g.group)).toEqual(['Haircuts', 'Beard', 'Combos', 'Extras']);
    expect(SERVICE_LIBRARY[0].items.map((i) => i.title)).toEqual(
      ['Haircut', 'Fade', 'Skin fade', 'Taper', 'Buzz cut', 'Kids cut', 'Senior cut', 'Line up', 'Hair design']);
    expect(SERVICE_LIBRARY[1].items.map((i) => i.title)).toEqual(['Beard trim', 'Beard shape-up', 'Hot towel shave', 'Razor line']);
    expect(SERVICE_LIBRARY[2].items.map((i) => i.title)).toEqual(['Haircut + beard', 'Cut + shave']);
    expect(SERVICE_LIBRARY[3].items.map((i) => i.title)).toEqual(
      ['Shampoo', 'Facial', 'Eyebrows', 'Hair colour', 'Braids', 'Locs retwist', 'Scalp treatment']);
  });
  it('defaults', () => {
    const find = (t: string) => SERVICE_LIBRARY.flatMap((g) => g.items).find((i) => i.title === t)!;
    expect(find('Skin fade').duration).toBe(45);
    expect(find('Beard trim').duration).toBe(15);
    expect(find('Haircut + beard').duration).toBe(45);
    expect(find('Line up').duration).toBe(15);
    expect(find('Hot towel shave').icon).toBe('mustache');
    expect(find('Facial').icon).toBe('face');
    expect(find('Braids').icon).toBe('sparkles');
  });
});
describe('service ops', () => {
  it('newService', () => {
    const s = newService('Fade', 30, 'scissors');
    expect(s).toMatchObject({ title: 'Fade', duration: '30 min', subtitle: '', description: '', imageUrl: '' });
    expect(s.price).toBeUndefined();
  });
  it('sets and removes price', () => {
    const d = addService(base(), newService('Fade', 30, 'scissors'));
    const a = updateService(d, 0, draft({ price: '35' }));
    expect(a.services[0].price).toBe('$35');
    const b = updateService(a, 0, draft({ price: '' }));
    expect('price' in b.services[0]).toBe(false);
  });
  it('keeps an unparseable price untouched', () => {
    const d = base([{ ...newService('Fade', 30, 'scissors'), price: 'From $25' }]);
    expect(updateService(d, 0, draft({ price: 'From $25' })).services[0].price).toBe('From $25');
  });
  it('keeps an unknown duration when none is chosen', () => {
    const d = base([{ ...newService('Fade', 30, 'scissors'), duration: 'about an hour' }]);
    expect(updateService(d, 0, draft({ duration: null })).services[0].duration).toBe('about an hour');
  });
  it('strips angle brackets', () => {
    const d = addService(base(), newService('x', 30, 'scissors'));
    expect(updateService(d, 0, draft({ title: '<b>Fade</b>' })).services[0].title).toBe('bFade/b');
  });
  it('remove and move do not mutate', () => {
    const d = base([newService('A', 30, 'scissors'), newService('B', 30, 'scissors')]);
    const m = moveService(d, 0, 1);
    expect(m.services.map((s) => s.title)).toEqual(['B', 'A']);
    expect(d.services.map((s) => s.title)).toEqual(['A', 'B']);
    expect(moveService(d, 0, -1)).toBe(d);
    expect(moveService(d, 1, 1)).toBe(d);
    expect(removeService(d, 0).services.map((s) => s.title)).toEqual(['B']);
    expect(d.services).toHaveLength(2);
  });
});
