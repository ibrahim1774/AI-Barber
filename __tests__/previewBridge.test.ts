import { generateContent } from '@/web/services/geminiService';
import type { WebsiteData } from '@/web/types';
import { parsePreviewMessage, shouldAllowPreviewRequest } from '@/lib/previewBridge';

let data: WebsiteData;
beforeAll(async () => {
  data = await generateContent({ shopName: 'Fresh Cuts', area: 'Brooklyn, NY', phone: '555-0100', template: 'luxe' });
  // generateContent no longer invents a menu: give the fixture three services with descriptions.
  const svc = (title: string) => ({ title, subtitle: '30 min', description: `${title} as you like it.`, price: '$30', icon: 'scissors' as const, imageUrl: '' });
  data = { ...data, template: 'luxe', staff: [{ name: 'Sam', photo: '' }], services: [svc('Haircut'), svc('Skin fade'), svc('Beard trim')] };
});

const msg = (o: unknown) => JSON.stringify(o);

describe('parsePreviewMessage', () => {
  test('accepts edit messages for editable text paths (after index expansion)', () => {
    expect(parsePreviewMessage(msg({ type: 'edit', path: 'hero.heading' }), data)).toEqual({ type: 'edit', path: 'hero.heading' });
    expect(parsePreviewMessage(msg({ type: 'edit', path: 'services.2.description' }), data)).toEqual({ type: 'edit', path: 'services.2.description' });
    expect(parsePreviewMessage(msg({ type: 'edit', path: 'about.description.0' }), data)).toEqual({ type: 'edit', path: 'about.description.0' });
  });

  test('accepts image messages for image slots', () => {
    expect(parsePreviewMessage(msg({ type: 'image', path: 'hero.imageUrl' }), data)).toEqual({ type: 'image', path: 'hero.imageUrl' });
    expect(parsePreviewMessage(msg({ type: 'image', path: 'gallery.0' }), data)).toEqual({ type: 'image', path: 'gallery.0' });
    expect(parsePreviewMessage(msg({ type: 'image', path: 'staff.0.photo' }), data)).toEqual({ type: 'image', path: 'staff.0.photo' });
  });

  test('accepts scrollY with a finite number and ready', () => {
    expect(parsePreviewMessage(msg({ type: 'scrollY', y: 420 }), data)).toEqual({ type: 'scrollY', y: 420 });
    expect(parsePreviewMessage(msg({ type: 'scrollY', y: -5 }), data)).toEqual({ type: 'scrollY', y: 0 });
    expect(parsePreviewMessage(msg({ type: 'ready' }), data)).toEqual({ type: 'ready' });
  });

  test('ignores junk', () => {
    for (const raw of ['', 'not json', '{', 'null', '42', '"edit"', '[]', '[{"type":"edit","path":"hero.heading"}]', msg({})]) {
      expect(parsePreviewMessage(raw, data)).toBeNull();
    }
    expect(parsePreviewMessage(undefined as unknown as string, data)).toBeNull();
  });

  test('ignores wrong types', () => {
    expect(parsePreviewMessage(msg({ type: 'navigate', path: 'hero.heading' }), data)).toBeNull();
    expect(parsePreviewMessage(msg({ type: 'edit', path: 42 }), data)).toBeNull();
    expect(parsePreviewMessage(msg({ type: 'edit' }), data)).toBeNull();
    expect(parsePreviewMessage(msg({ type: 'scrollY', y: '100' }), data)).toBeNull();
    expect(parsePreviewMessage(msg({ type: 'scrollY', y: null }), data)).toBeNull();
    expect(parsePreviewMessage('{"type":"scrollY","y":1e999}', data)).toBeNull();
    expect(parsePreviewMessage(msg({ type: ['edit'], path: 'hero.heading' }), data)).toBeNull();
  });

  test('ignores unknown or cross-kind paths', () => {
    expect(parsePreviewMessage(msg({ type: 'edit', path: 'hero.imageUrl' }), data)).toBeNull(); // image slot via edit
    expect(parsePreviewMessage(msg({ type: 'image', path: 'hero.heading' }), data)).toBeNull(); // text via image
    expect(parsePreviewMessage(msg({ type: 'edit', path: 'services.99.title' }), data)).toBeNull(); // out of range
    expect(parsePreviewMessage(msg({ type: 'edit', path: 'services.{i}.title' }), data)).toBeNull(); // raw pattern
    expect(parsePreviewMessage(msg({ type: 'edit', path: '__proto__.polluted' }), data)).toBeNull();
    expect(parsePreviewMessage(msg({ type: 'edit', path: 'contact.email' }), { ...data, contact: { ...data.contact, email: 'a@b.co' } })).not.toBeNull(); // editable since editable-everywhere, once the page prints it
    expect(parsePreviewMessage(msg({ type: 'edit', path: 'contact.email' }), { ...data, contact: { ...data.contact, email: '' } })).toBeNull(); // no value, no marker, not tappable
    expect(parsePreviewMessage(msg({ type: 'edit', path: 'policy.title' }), data)).toBeNull(); // prime-only, luxe site
    expect(parsePreviewMessage(msg({ type: 'edit', path: 'contact.phone' }), data)).toBeNull(); // not a field
    expect(parsePreviewMessage(msg({ type: 'image', path: 'gallery.99' }), data)).toBeNull();
    expect(parsePreviewMessage(msg({ type: 'image', path: 'staff.1.photo' }), data)).toBeNull();
  });
});

describe('shouldAllowPreviewRequest', () => {
  const top = { isTopFrame: true };
  test('allows the in-memory document load (initial and every re-render)', () => {
    expect(shouldAllowPreviewRequest({ ...top, url: 'about:blank', navigationType: 'other' })).toBe(true);
  });

  test('blocks every top-frame navigation', () => {
    const urls = [
      'https://booksy.com/en-us/dl/show-business/998736',
      'http://example.com',
      'tel:5550100',
      'tel:+15550100',
      'mailto:a@b.co',
      'sms:5550100',
      'javascript:alert(1)',
      'about:blank#services',
      'file:///etc/passwd',
      'data:text/html,hi',
      'https://maps.google.com/maps?q=x&output=embed', // allowed only as a subframe
    ];
    for (const url of urls) {
      for (const navigationType of ['click', 'formsubmit', 'other', 'reload', 'backforward', 'formresubmit'] as const) {
        expect(shouldAllowPreviewRequest({ ...top, url, navigationType })).toBe(false);
      }
    }
  });

  test('blocks about:blank when it comes from a click / form post', () => {
    expect(shouldAllowPreviewRequest({ ...top, url: 'about:blank', navigationType: 'click' })).toBe(false);
    expect(shouldAllowPreviewRequest({ ...top, url: 'about:blank', navigationType: 'formsubmit' })).toBe(false);
  });

  test('treats a request without isTopFrame as top-frame', () => {
    expect(shouldAllowPreviewRequest({ url: 'https://evil.example', navigationType: 'other' })).toBe(false);
    expect(shouldAllowPreviewRequest({ url: 'about:blank', navigationType: 'other' })).toBe(true);
  });

  test('lets the Google Maps embed iframe load, nothing else in a subframe', () => {
    const sub = { isTopFrame: false, navigationType: 'other' as const };
    expect(shouldAllowPreviewRequest({ ...sub, url: 'https://maps.google.com/maps?q=Fresh%20Cuts&output=embed' })).toBe(true);
    expect(shouldAllowPreviewRequest({ ...sub, url: 'https://www.google.com/maps/embed?pb=abc' })).toBe(true);
    expect(shouldAllowPreviewRequest({ ...sub, url: 'about:blank' })).toBe(true);
    expect(shouldAllowPreviewRequest({ ...sub, url: 'https://maps.google.com.evil.example/maps' })).toBe(false);
    expect(shouldAllowPreviewRequest({ ...sub, url: 'http://maps.google.com/maps?q=x' })).toBe(false);
    expect(shouldAllowPreviewRequest({ ...sub, url: 'https://www.google.com/search?q=x' })).toBe(false);
    expect(shouldAllowPreviewRequest({ ...sub, url: 'https://booksy.com/x' })).toBe(false);
    expect(shouldAllowPreviewRequest({ ...sub, url: 'tel:5550100' })).toBe(false);
    // a click inside the map ("View larger map") is a navigation, blocked
    expect(shouldAllowPreviewRequest({ isTopFrame: false, navigationType: 'click', url: 'https://www.google.com/maps/place/x' })).toBe(false);
  });
});
