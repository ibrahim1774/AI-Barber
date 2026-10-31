import { merge3 } from '@/lib/mergeSite';

const base = { hero: { heading: 'H', tagline: 'T' }, about: { heading: 'A', description: ['d'] }, phone: '1', services: [{ title: 'Cut', price: '$30' }, { title: 'Beard', price: '$20' }] };

describe('merge3 (two devices edit at once)', () => {
  it('keeps both devices\' edits to different fields', () => {
    const local = { ...base, hero: { ...base.hero, tagline: 'PHONE' } };
    const server = { ...base, about: { ...base.about, heading: 'LAPTOP' } };
    const m: any = merge3(base, local, server);
    expect(m.hero.tagline).toBe('PHONE');
    expect(m.about.heading).toBe('LAPTOP');
    expect(m.phone).toBe('1');
  });
  it('a field both changed keeps this device\'s value', () => {
    const m: any = merge3(base, { ...base, phone: 'L' }, { ...base, phone: 'S' });
    expect(m.phone).toBe('L');
  });
  it('merges different services edited on each device', () => {
    const local = { ...base, services: [{ title: 'Cut', price: '$35' }, base.services[1]] };
    const server = { ...base, services: [base.services[0], { title: 'Beard', price: '$25' }] };
    const m: any = merge3(base, local, server);
    expect(m.services).toEqual([{ title: 'Cut', price: '$35' }, { title: 'Beard', price: '$25' }]);
  });
  it('an added service on one side and a text edit on the other both survive', () => {
    const local = { ...base, services: [...base.services, { title: 'New', price: '$10' }] };
    const server = { ...base, hero: { ...base.hero, heading: 'S' } };
    const m: any = merge3(base, local, server);
    expect(m.services).toHaveLength(3);
    expect(m.hero.heading).toBe('S');
  });
  it('nothing changed here: the other device\'s copy is taken as is; nothing changed there: ours', () => {
    expect(merge3(base, base, { ...base, phone: 'S' })).toEqual({ ...base, phone: 'S' });
    expect(merge3(base, { ...base, phone: 'L' }, base)).toEqual({ ...base, phone: 'L' });
  });
  it('a field removed on the other device and untouched here is removed', () => {
    const { phone: _p, ...rest } = base;
    expect((merge3(base, base, rest) as any).phone).toBeUndefined();
  });
});
