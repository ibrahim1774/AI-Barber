// Fix round 12d: every barber-controlled string goes into a strict library sentence ONLY through spliceable(kind, value),
// a strict whitelist that never repairs or re-cases text. Table tests per kind, a seeded fuzz over the real sentences, and
// scans proving nothing reaches a strict sentence around the gate.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SERVICE_ALT, SERVICE_VISIT } from '../../lib/render/copyLibrary';
import { outputProblems, strictProblems, copyProblems, isKnownToken, TEXT_TOKENS, TOKEN_RE } from '../../lib/render/copyRules';
import { lenientEnv, resolveBlock, resolveSentence, segsText, svcCopyKey, type CopyEnv, type Svc } from '../../lib/render/guides';
import { SPLICE_KINDS, TOKEN_KIND, spliceable, type SpliceKind } from '../../lib/render/spliceable';
import { displayPhone, displayPrice } from '../../lib/render/honest';
import type { WebsiteData } from '../../types';

const D = (o: { shop?: string; phone?: string; address?: string; title?: string; price?: string; duration?: string } = {}): WebsiteData => ({
  shopName: o.shop ?? 'Fresh Cuts', area: 'Austin, TX', phone: o.phone ?? '(512) 555-0100', bookingUrl: '/book', template: 'luxe',
  hero: { heading: 'x', tagline: '', imageUrl: '' }, about: { heading: 'About', description: ['x'], imageUrl: '' },
  services: [{ title: o.title ?? 'Fade', subtitle: '', description: '', icon: 'scissors', imageUrl: '', price: o.price ?? '$30', duration: o.duration ?? '30 min' }], gallery: [],
  hours: [{ day: 'Mon', open: '09:00', close: '17:00' }], contact: { address: o.address ?? '12 Main St, Austin, TX', email: '' },
  pages: { order: [], hidden: [] }, extraPages: { on: [], serviceGuides: true, seed: 1 }, source: 'web-app',
} as unknown as WebsiteData);
const subj = (d: WebsiteData): Svc => { const s = d.services[0]; return { index: 0, title: s.title, price: s.price ?? '', duration: s.duration ?? '', guide: null }; };
const run = (d: WebsiteData, sentence: string, links?: CopyEnv['links']) => {
  const r = resolveSentence(lenientEnv(d, links ? { links } : {}), sentence, [], subj(d), true);
  return r ? segsText(r) : null;
};

describe('spliceable: exhaustive tables', () => {
  const table: Record<SpliceKind, { ok: string[]; bad: string[] }> = {
    phone: {
      ok: ['(512) 555-0100', '+44 (0)20 7946 0958', '+1 (512) 555-0100', '5125550100', '512.555.0100', '512-555-0100', '  512 555 0100  ', '+52 55 1234 5678'],
      bad: ['Call or text (512) 555-0100', 'Text 512-555-0100', 'Call us 512-555-0100', '555-0100 (text only)', '512.555.0100 ext. 2', 'Call us!!!', '', '   ', '12345', '1234567890123456', '()', '+', '#', '💈', '555-0100--1', '5 12+555 0100', '((512) 555-0100', '(512)) 555-0100', '<b>5125550100</b>', '512 555 0100\n', 'abc', 'x5125550100', '512-555-0100-', '+$5125550100'],
    },
    price: {
      ok: ['$25', '$25.50', '$25-$40', '$25 - $40', '$25+', '25 USD', '25-40 USD', '£30', '€30', '$1,5'],
      bad: ['~$30', 'from $20', 'FREE', 'Free', '25', 'Call for price', 'Varies', '$', '$$$', '#', '💈', '', '$0', '$0.00', '+$25', '$25 <b>', '$25!', '$25\n', '$123456', '$25-', '-$25'],
    },
    duration: {
      ok: ['45 min', '45 mins', '30 minutes', '1h 30m', '1.5 hrs', '90 minutes', '30-45 mins', '1 hour', '1 hr 15 min', '1 hour and 30 minutes'],
      bad: ['~30 min', '+30 min', '30', 'Varies', '0 min', '', '#', '💈', 'min', '1 day', '45 min!', '45 min <b>', 'about 30 min', '45 minutes\n', '1h30'],
    },
    label: {
      ok: ['Book now', 'Book Now', 'BOOK NOW', 'BOOK WITH TONY', 'Location', 'Where Are We', 'eBay Store', 'Book with iPhone', "Tony's Page", 'Map & Parking', 'FAQ', 'Contact'],
      bad: ['Book Now!', 'Book now.', 'Where Are We?', 'Call us!!!', 'Book now. Pay later', 'Hours: 9-5', 'Book →', '<script>x</script>', '<b>Book</b>', '', '   ', '!!!', '💈', '#', '&', 'Book & ', '& Book', 'Book && Pay', 'https://x.com/book', 'a b c d', 'Reserve your spot at our shop today now', 'Book\nNow', 'Check-in', 'Book (Online', '📍 Map', 'Find Us;'],
    },
    name: {
      ok: ['Fresh Cuts', 'St. Louis Cuts', 'Mr. Fade', 'No. 1 Cut', 'Dr. Fade & Co. Cuts', 'FRESH CUTS', 'fresh cuts', '#1 Barbers', '#1 Cut', 'Skin Fade (Mid)', "Kids' Cut", 'Cut & Style', 'Fade + Beard', 'Fade 2.0', 'R&B Cuts', 'Line-Up', 'The Works', 'MVP Cut', 'Cuts, Fades', 'Tony’s', 'قص شعر', 'Café Niño', 'Boys\''],
      bad: ['#', '&', '$$$', '%', '💈', '💈💈', '!!!', '', '   ', '- Fade', '+ Beard', '¿Corte?', '**Fade**', '*New* Fade', '•Fade', '— Fade —', 'Cut & Style &', 'Fade*', 'Fade.', 'Barber & Co.', 'Fast. Cuts', 'Cut. Fade', 'Mr..Fade', 'Mr. ', 'Shave? Yes!', 'Fade (', 'Fade )', '"Fade', '“Fade', "'Fade", '<script>alert(1)</script>', '<b>x</b> Cut', 'Call us!!!', '~$30 Cut', 'Cut #', 'Fade & & Beard', 'Fade (Mid), Cut', 'Cut.Fade, ', 'A'.repeat(101), 'Fade\nCut', 'Fade 💈', 'Fade; Cut', 'Fade@home', 'Fade () Cut', '(Fade)', 'Fade​', 'Fade -', 'Fade +', 'Fade /', 'Fade –', 'Fade ,', 'Fade #'],
    },
    address: {
      ok: ['12 Main St, Austin, TX', '12 Main St., Austin, TX', '12 Main St. Suite 4', '#4 Oak Ave', '123 Calle 5, Col. Centro', 'Suite 4, 12 Main St', '12 Main St'],
      bad: ['Mobile - I come to you', 'Austin, TX', '', 'PO Box 12 Main', '<b>12 Main St</b>', '12 Main St\nAustin, TX', '123 Calle 5; Col. Centro', 'Call us!!!', '12 Main St.', '12 Main St,', '12 Main St ,', '12 Main St,,Austin', `12 ${'Main '.repeat(30)}St`, '12 Main St →', '- 12 Main St', '– 12 Main St', ', 12 Main St', '(12 Main St)', '. 12 Main St', '/ 12 Main St', '💈 12 Main St', '((12 Main St)'],
    },
    count: { ok: ['1', '7', ' 5 '], bad: ['0', '8', '10', 'seven', '', '5\n', '5.0'] },
  };
  for (const kind of SPLICE_KINDS) {
    it(`${kind}: valid values pass exactly as typed (spaces collapsed)`, () => {
      for (const v of table[kind].ok) expect(spliceable(kind, v), JSON.stringify(v)).toBe(v.replace(/[ \t]+/g, ' ').trim());
    });
    it(`${kind}: invalid and hostile values are omitted, never fixed up`, () => {
      for (const v of table[kind].bad) expect(spliceable(kind, v), JSON.stringify(v)).toBeNull();
    });
    it(`${kind}: non-strings are omitted`, () => {
      for (const v of [undefined, null, 5, {}, [], true]) expect(spliceable(kind, v)).toBeNull();
    });
  }
  it('never changes case', () => {
    for (const v of ['BOOK WITH TONY', 'eBay Store', 'fresh cuts', 'FRESH CUTS', 'iPhone Fade']) {
      for (const k of ['label', 'name'] as const) { const out = spliceable(k, v); if (out !== null) expect(out).toBe(v); }
    }
  });
});

describe('full sentence: the 12d reviewer cases', () => {
  const phone = (p: string) => run(D({ phone: p }), 'To talk to the shop before booking, call {phone}.');
  it('B1: a phone holding words drops its sentence; real phones print', () => {
    for (const p of ['Call or text (512) 555-0100', 'Text 512-555-0100', 'Call us 512-555-0100', '555-0100 (text only)']) expect(phone(p), p).toBeNull();
    expect(phone('+44 (0)20 7946 0958')).toBe('To talk to the shop before booking, call +44 (0)20 7946 0958.');
    expect(phone('+1 (512) 555-0100')).toContain('+1 (512) 555-0100');
    expect(phone('5125550100')).toContain('(512) 555-0100');
  });
  it('B2: names in labels keep the owner capitalisation or the sentence drops', () => {
    const links = (l: string): CopyEnv['links'] => ({ book: { href: '/book', label: l }, location: { href: '/loc', label: l } });
    const book = (l: string) => run(D(), 'To book, use the {link:book} link.', links(l));
    expect(book('BOOK WITH TONY')).toBe('To book, use the BOOK WITH TONY link.');
    expect(book('eBay Store')).toBe('To book, use the eBay Store link.');
    expect(book('Book with iPhone')).toBe('To book, use the Book with iPhone link.');
    expect(book('BOOK NOW')).toBe('To book, use the BOOK NOW link.');
    for (const l of ['Book Now!', 'Where Are We?', 'Hours: 9-5', '', '!!!']) expect(book(l), l).toBeNull();
  });
  it('B3: values with no letter or digit, and symbol leftovers, drop the sentence', () => {
    for (const t of ['#', '&', '$$$', '%', '\u{1F488}', '**Fade**', 'Fade*', '•Fade', '— Fade —', 'Cut & Style &']) expect(run(D({ title: t }), 'Ready to book {service}?'), t).toBeNull();
    for (const s of ['\u{1F488}\u{1F488}', '&']) expect(run(D({ shop: s }), '{shop} lists {service} on its service menu.'), s).toBeNull();
    expect(run(D({ title: '#1 Cut' }), 'Ready to book {service}?')).toBe('Ready to book #1 Cut?');
    expect(run(D({ price: '$25+' }), 'This service is listed at {price}.')).toBe('This service is listed at $25+.');
  });
  it('lower-case owner text is never re-cased: a shop that opens the sentence in lower case drops it', () => {
    expect(run(D({ shop: 'fresh cuts' }), '{shop} lists {service} on its service menu.')).toBeNull();
    expect(run(D({ shop: 'FRESH CUTS' }), '{shop} lists {service} on its service menu.')).toBe('FRESH CUTS lists Fade on its service menu.');
    expect(run(D({ title: 'low fade' }), 'Ready to book {service}?')).toBe('Ready to book low fade?');
  });
  it('S1 and N-b/N-c: a question or colon label and a semicolon address are omitted', () => {
    const links: CopyEnv['links'] = { location: { href: '/loc', label: 'Where Are We?' } };
    expect(run(D(), 'The shop is at {address}, and the {link:location} page has directions.', links)).toBeNull();
    expect(run(D({ address: '123 Calle 5; Col. Centro' }), 'The shop is at {address}, and the {link:location} page has directions.')).toBeNull();
  });
});

// ── Fuzz ────────────────────────────────────────────────────────────────────────────────────────
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const PIECES = ['Call', 'or', 'text', 'us', '(512)', '555-0100', '+44', '(0)20', '7946', '0958', 'ext.', 'x', '2', '<b>', '</b>', '<script>', '&', '&lt;', '&amp;', '\u{1F488}', '#', '#1', '*', '**', '!!!', '?', '—', '-', '.', ',', ';', ':', '$', '$25', '25', '40', '-$40', '~', '+', 'min', 'mins', 'h', '30', '1.5', 'hrs', 'Fade', 'cut', 'Cut', 'BOOK', 'NOW', 'tony', "Tony's", 'iPhone', 'Main', 'St', '12', 'Oak', 'Ave', '"', "'", '(', ')', '\n', '\t', '0', 'FREE', 'from', '¿', '•', 'قص', 'café', 'Book', 'Now!', 'with', '45 min', '1h 30m', '30-45 mins', '12 Main St', 'Fresh Cuts', '(512) 555-0100', '5125550100', 'Map', 'Location', 'page', 'link', 'Book now', 'lists', 'book', 'Ready', 'Looking', 'for'];
const fuzzValue = (r: () => number): string => {
  const n = 1 + Math.floor(r() * 6);
  let s = r() < 0.25 ? ' ' : '';
  for (let i = 0; i < n; i++) s += PIECES[Math.floor(r() * PIECES.length)] + (r() < 0.8 ? ' ' : '');
  return r() < 0.3 ? s.trim() : s;
};
const wk = (w: string): string => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
/** No repetition at the seam between a library word and the value ("call Call", "book Book", "page page"). */
function noSeamRepeat(out: string, value: string): void {
  let at = out.indexOf(value);
  while (at >= 0 && (/[\p{L}\p{N}]$/u.test(out.slice(0, at)) || /^[\p{L}\p{N}]/u.test(out.slice(at + value.length)))) at = out.indexOf(value, at + 1);
  expect(at, `${out} should hold ${value}`).toBeGreaterThanOrEqual(0);
  const prev = /([\p{L}\p{N}']+)\s+$/u.exec(out.slice(0, at))?.[1];
  const next = /^\s+([\p{L}\p{N}']+)/u.exec(out.slice(at + value.length))?.[1];
  const w = value.split(' ');
  if (prev) expect(wk(prev), `seam before: ${out}`).not.toBe(wk(w[0]));
  if (next) expect(wk(next), `seam after: ${out}`).not.toBe(wk(w[w.length - 1]));
}
const noGlue = (out: string): void => {
  expect(outputProblems(out, { repeats: false }), out).toEqual([]);
  expect(out, out).not.toMatch(/[<>]/);
  expect(out, out).not.toMatch(/&[#a-z0-9]+;/i);
  expect(out, out).not.toMatch(/\b(?:undefined|null|NaN)\b/);
};

describe('property: 2000 random strings per kind are omitted or print lint-clean', () => {
  const visit = SERVICE_VISIT.variants.flat();
  it('the library text itself passes R1 to R18', () => {
    for (const s of [...visit, ...Object.values(SERVICE_ALT).flatMap((b) => b.variants.flat())]) {
      expect(strictProblems(s), s).toEqual([]);
    }
  });
  interface Case { name: string; kind: SpliceKind; tokens: string[]; build: (v: string) => { d: WebsiteData; links?: CopyEnv['links']; gate: string } }
  const cases: Case[] = [
    { name: 'phone', kind: 'phone', tokens: ['phone'], build: (v) => ({ d: D({ phone: v }), gate: displayPhone(v.trim()) }) },
    { name: 'price', kind: 'price', tokens: ['price'], build: (v) => ({ d: D({ price: v }), gate: displayPrice(v.trim()) }) },
    { name: 'duration', kind: 'duration', tokens: ['duration'], build: (v) => ({ d: D({ duration: v }), gate: v.trim() }) },
    { name: 'address', kind: 'address', tokens: ['address'], build: (v) => ({ d: D({ address: v }), gate: v.trim() }) },
    { name: 'shop name', kind: 'name', tokens: ['shop'], build: (v) => ({ d: D({ shop: v }), gate: v.trim() }) },
    { name: 'service title', kind: 'name', tokens: ['service'], build: (v) => ({ d: D({ title: v }), gate: v.trim() }) },
    { name: 'link label', kind: 'label', tokens: ['link:book', 'link:location'], build: (v) => ({ d: D(), links: { book: { href: '/book', label: v }, location: { href: '/loc', label: v } }, gate: v }) },
  ];
  for (const c of cases) {
    it(`${c.name}`, () => {
      const r = rng(1234 + c.name.length * 7 + Number(process.env.FUZZ_SEED ?? 0));
      const templates = visit.filter((s) => c.tokens.some((t) => s.includes(`{${t}}`)));
      expect(templates.length).toBeGreaterThan(0);
      let printed = 0;
      for (let i = 0; i < 2000; i++) {
        const v = fuzzValue(r);
        const { d, links, gate } = c.build(v);
        const value = spliceable(c.kind, gate);
        for (const t of templates) {
          const out = run(d, t, links);
          if (out === null) continue;
          printed++;
          // Printed only because the whitelist let the value through, exactly as typed.
          expect(value, `${JSON.stringify(v)} -> ${out}`).not.toBeNull();
          noGlue(out);
          noSeamRepeat(out, value!);
          expect(/[\p{L}\p{N}]/u.test(value!)).toBe(true);
          expect(value!).not.toMatch(/^[^\p{L}\p{N}]+$/u);
          // Independent of the validators: what prints must start and end like a real name, phone, price or address.
          if (c.kind === 'name' || c.kind === 'address') {
            expect(value!, `start of ${value}`).toMatch(/^[\p{L}\p{N}#]/u);
            expect(value!, `end of ${value}`).toMatch(/[\p{L}\p{N})'’]$/u);
          }
        }
        if (value === null) for (const t of templates) expect(run(d, t, links), `${JSON.stringify(v)} must be omitted`).toBeNull();
      }
      expect(printed, 'the fuzz must also reach the print side').toBeGreaterThan(0);
    });
  }
});

// ── Bypass scans ────────────────────────────────────────────────────────────────────────────────
describe('no library block can reach a raw owner string around spliceable()', () => {
  const src = readFileSync(new URL('../../lib/render/guides.ts', import.meta.url), 'utf8');
  const strictBlocks: Array<[string, string]> = [
    ...SERVICE_VISIT.variants.flat().map((s) => ['visit', s] as [string, string]),
    ...Object.entries(SERVICE_ALT).flatMap(([g, b]) => b.variants.flat().map((s) => [`alt.${g}`, s] as [string, string])),
  ];

  it('every token in a strict block has a whitelist kind (or the block cannot be strict)', () => {
    for (const [id, s] of strictBlocks) for (const m of s.matchAll(TOKEN_RE)) {
      expect(isKnownToken(m[1], m[2]), `${id}: ${s}`).toBe(true);
      expect(TOKEN_KIND[m[1]], `${id}: {${m[1]}} has no kind in TOKEN_KIND: ${s}`).toBeTruthy();
    }
  });
  it('every library token name has an explicit TOKEN_KIND entry', () => {
    for (const t of [...TEXT_TOKENS, 'link', 'svc']) expect(Object.prototype.hasOwnProperty.call(TOKEN_KIND, t), t).toBe(true);
    for (const k of Object.values(TOKEN_KIND)) if (k) expect(SPLICE_KINDS).toContain(k);
  });
  it('library text holds no raw interpolation and nothing that is not a known token', () => {
    for (const [id, s] of strictBlocks) {
      expect(s, id).not.toMatch(/\$\{|<|>|\\n/);
      expect(copyProblems(s, { strict: true, allow: ['fade', 'taper', 'line-up', 'beard-trim', 'beard', 'shave', 'kids-cut', 'design', 'color', 'cut-beard'] }).filter((p) => /token|brace/.test(p)), `${id}: ${s}`).toEqual([]);
    }
  });
  it('guides.ts: tokenSeg is called from resolveSentence only, whose strict path ends in spliceable()', () => {
    expect(src.match(/\btokenSeg\(/g)!.length).toBe(2); // the definition and the one call
    const fn = src.slice(src.indexOf('export function resolveSentence'), src.indexOf('export interface ResolvedBlock'));
    expect(fn.indexOf('tokenSeg(')).toBeGreaterThan(-1);
    expect(fn).toMatch(/if \(strict\) \{[\s\S]*spliceable\(kind, seg\.t === 'link' \? seg\.label : seg\.s\)[\s\S]*if \(v === null\) return null;[\s\S]*\}\s*push\(seg\)/);
    expect(fn).toMatch(/const kind = TOKEN_KIND\[m\[1\]\];\s*if \(!kind\) return null;/);
    // The old cleaning functions are gone: nothing re-cases or repairs owner text.
    expect(src).not.toMatch(/function tidy(?:Value|Label)|toUpperCase\(\)|toLowerCase\(\)\s*\)?\s*;?\s*seg =/);
  });
  it('strict keys (svc.*.visit|alt) always resolve with strict = true', () => {
    expect(src).toMatch(/scope: 'service', kind: 'service', strict: true/);
    expect(src).toMatch(/scope: g, kind: 'service', strict: true/);
  });
  it('behaviour: a hostile marker in every owner field never reaches any strict block in any wording', () => {
    const hostile = 'ZZQ<i>';
    for (const title of ['Fade', 'Braids', 'Skin Fade']) for (const wording of [0, 1, 2]) {
      const d = D({ shop: hostile, phone: hostile, address: hostile, price: hostile, duration: hostile, title });
      (d as unknown as { extraPages: unknown }).extraPages = { on: [], serviceGuides: true, seed: 1, pick: { [svcCopyKey(title, 'visit')]: wording, [svcCopyKey(title, 'alt')]: wording } };
      const env = lenientEnv(d, { links: { book: { href: '/b', label: hostile }, location: { href: '/l', label: hostile }, hours: { href: '/h', label: hostile }, contact: { href: '/c', label: hostile }, services: { href: '/s', label: hostile } } });
      for (const part of ['visit', 'alt'] as const) {
        const b = resolveBlock(env, svcCopyKey(title, part));
        const text = b ? b.items.map((it) => segsText(it)).join(' ') : '';
        expect(text, `${title} ${part} ${wording}`).not.toContain('ZZQ');
        expect(text).not.toMatch(/[<>]/);
      }
    }
  });
  it('N-f: no sentence after one holding {service} points back at it with a pronoun', () => {
    for (const w of SERVICE_VISIT.variants) {
      const i = w.findIndex((s) => /\{service\}/.test(s));
      if (i < 0) continue;
      for (const later of w.slice(i + 1)) expect(later.replace(TOKEN_RE, ' tok ').match(/\b(?:it|they|them|these|those|ones?)\b/i), later).toBeNull();
    }
  });
});
