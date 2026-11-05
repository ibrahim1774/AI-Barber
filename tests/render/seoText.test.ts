// Phase 1 step 4: owner SEO title / description (seo.* copy keys). The validator is judged against an INDEPENDENT oracle (a
// hand-written table of good and bad strings, not the validator's own regexes), then against hostile strings.
import { describe, expect, it } from 'vitest';
import {
  MAX_SEO_KEYS, SEO_DESCRIPTION_MAX, SEO_RAW_MAX, SEO_TITLE_MAX, isSeoKey, parseSeoKey, seoDuplicates, seoKey, seoOverride, seoProblem, seoSvcKey, validSeoText,
} from '../../lib/render/seoText';

const T = (s: unknown) => validSeoText('title', s);
const D = (s: unknown) => validSeoText('description', s);

describe('validSeoText: independent oracle', () => {
  const GOOD_TITLES: Array<[string, string]> = [
    ['Skin Fade in Brooklyn | Fresh Cuts', 'Skin Fade in Brooklyn | Fresh Cuts'],
    ['  Fresh   Cuts   Barbershop  ', 'Fresh Cuts Barbershop'], // spaces collapse and trim: the only normalisation
    ['NYC Fades', 'NYC Fades'],
    ['Barbería Línea · Café', 'Barbería Línea · Café'],
    ['حلاقة الأحمد', 'حلاقة الأحمد'], // RTL letters are fine
    ['理髪店 さくら', '理髪店 さくら'],
    ['Kids\' Cuts & Fades', 'Kids\' Cuts & Fades'], // a bare ampersand is fine, an entity is not
    ['A'.repeat(1) + 'B', 'AB'], // two letters, caps but too few cased letters to be shouting
    ['BMW Fades', 'BMW Fades'],
    ['x'.repeat(SEO_TITLE_MAX), 'x'.repeat(SEO_TITLE_MAX)],
    ['Fade 2 Go', 'Fade 2 Go'],
  ];
  it.each(GOOD_TITLES)('title accepts %j', (input, out) => expect(T(input)).toBe(out));

  const BAD_TITLES: Array<[string, unknown]> = [
    ['empty', ''], ['spaces only', '    '], ['not a string: number', 5], ['not a string: null', null], ['not a string: array', ['x']],
    ['not a string: object', { toString: () => 'ok title' }],
    ['one letter', 'A'], ['only punctuation', '!!! --- ???'], ['only symbols', '$$$'], ['only a dash', '-'],
    ['61 characters', 'x'.repeat(SEO_TITLE_MAX + 1)],
    ['script tag', '<script>alert(1)</script>'], ['tag inside', 'Fades <b>by Sam</b>'], ['lone <', 'Fades < Sam'], ['lone >', 'Fades > Sam'],
    ['entity', 'Fades &amp; Sam'], ['numeric entity', 'Fades &#60;'], ['hex entity', 'Fades &#x3c;b'],
    ['newline', 'Fresh\nCuts'], ['tab', 'Fresh\tCuts'], ['carriage return', 'Fresh\rCuts'], ['NUL', 'Fresh\u0000Cuts'], ['DEL', 'Fresh\u007fCuts'], ['C1 control', 'Fresh\u0085Cuts'],
    ['line separator', 'Fresh Cuts'], ['paragraph separator', 'Fresh Cuts'],
    ['zero width space', 'Fresh​Cuts'], ['bidi override (RLO)', 'Fresh‮Cuts'], ['bidi isolate', 'Fresh⁦Cuts'], ['BOM', '﻿Fresh Cuts'],
    ['editor marker U+2063', '⁣Fresh Cuts⁣'], ['soft hyphen', 'Fresh­Cuts'], ['non-breaking space', 'Fresh Cuts'], ['ideographic space', 'Fresh　Cuts'],
    ['private use', 'FreshCuts'], ['lone surrogate', 'Fresh\ud800Cuts'],
    ['emoji', 'Fresh Cuts ✂️💈'], ['emoji only', '💈💈'], ['flag', 'Cuts 🇺🇸'],
    ['shouting', 'BEST BARBER IN TOWN'], ['shouting with a lower word', 'BOOK NOW BEST FADES in town'], ['symbol run', 'Fresh Cuts!!!!'], ['dash run', 'Fresh ---- Cuts'],
    ['10k characters', 'x'.repeat(10_000)], ['400+ raw characters of spaces and text', `${' '.repeat(SEO_RAW_MAX)}ok title`],
  ];
  it.each(BAD_TITLES)('title refuses %s', (_n, input) => expect(T(input)).toBeNull());

  it('the title limit is counted in characters, not UTF-16 units', () => {
    expect(T('𠀀'.repeat(SEO_TITLE_MAX))).not.toBeNull(); // CJK extension B letters: 60 code points, 120 units
    expect(T('𠀀'.repeat(SEO_TITLE_MAX + 1))).toBeNull();
  });
  it('a description is allowed up to 160 and refused at 161', () => {
    expect(D('word '.repeat(31) + 'wo')).not.toBeNull(); // 157
    expect(D('x'.repeat(SEO_DESCRIPTION_MAX))).toBe('x'.repeat(SEO_DESCRIPTION_MAX));
    expect(D('x'.repeat(SEO_DESCRIPTION_MAX + 1))).toBeNull();
    expect(T('x'.repeat(SEO_DESCRIPTION_MAX))).toBeNull(); // 160 is too long for a title
  });
  it('a description follows the same plain-text rules', () => {
    for (const bad of ['<img src=x onerror=alert(1)>', 'Line one\nline two', 'Book now‮', '💈 best cuts in town today', '!!!!!!!!!!', 'SHOUTING ABOUT THE BEST CUTS']) expect(D(bad), bad).toBeNull();
    expect(D('Walk-ins welcome. Skin fades, tapers and beard trims in Brooklyn, NY.')).toBe('Walk-ins welcome. Skin fades, tapers and beard trims in Brooklyn, NY.');
  });
  it('never repairs: a refused value is not cut, stripped or re-cased', () => {
    for (const bad of ['<b>Fresh</b> Cuts', 'Fresh\nCuts', 'FRESH CUTS BARBERS', 'Fresh Cuts 💈']) expect(T(bad)).toBeNull();
  });
  it('shouting threshold: six cased letters, more than half capitals', () => {
    expect(T('FADES')).toBe('FADES'); // five cased letters
    expect(T('FADEZZ')).toBeNull();
    expect(T('Sam FADES')).toBeNull(); // S + FADES = 6 of 8 cased letters are capitals
    expect(T('Sam Fades')).toBe('Sam Fades');
  });
});

describe('keys', () => {
  it('seoKey and seoSvcKey build the key families', () => {
    expect(seoKey('home', 'title')).toBe('seo.home.title');
    expect(seoKey('first-visit', 'description')).toBe('seo.first-visit.description');
    expect(seoSvcKey('  Skin   FADE ', 'title')).toBe('seo.svc.skin fade.title');
  });
  it('parseSeoKey accepts page keys and canonical service keys only', () => {
    expect(parseSeoKey('seo.home.title')).toEqual({ target: 'page', id: 'home', kind: 'title' });
    expect(parseSeoKey('seo.svc.skin fade.description')).toEqual({ target: 'svc', id: 'skin fade', kind: 'description' });
    for (const bad of ['seo.nope.title', 'seo.home.other', 'seo.svc..title', 'seo.svc.Skin Fade.title', 'seo.svc.a  b.title', 'seo.__proto__.title', 'seo.home.title.x', 'copy.seo.home.title', '', 5, null]) expect(parseSeoKey(bad as never), String(bad)).toBeNull();
    expect(isSeoKey('seo.services.title')).toBe(true);
  });
});

describe('seoOverride', () => {
  it('returns a valid value, null for an invalid, missing or inherited one', () => {
    const copy = { 'seo.home.title': ' Fresh  Cuts ', 'seo.home.description': '<script>', 'seo.faq.title': 'FRESH CUTS BARBERS' };
    expect(seoOverride({ copy }, 'seo.home.title')).toBe('Fresh Cuts');
    expect(seoOverride({ copy }, 'seo.home.description')).toBeNull();
    expect(seoOverride({ copy }, 'seo.faq.title')).toBeNull();
    expect(seoOverride({ copy }, 'seo.about.title')).toBeNull();
    expect(seoOverride({}, 'seo.home.title')).toBeNull();
    expect(seoOverride({ copy: [] as never }, 'seo.home.title')).toBeNull();
    const inherited = Object.create({ 'seo.home.title': 'Inherited title' });
    expect(seoOverride({ copy: inherited }, 'seo.home.title')).toBeNull();
  });
});

describe('seoProblem (server)', () => {
  const sd = (copy: unknown) => ({ copy });
  it('passes sites with no copy, other copy keys and valid or empty seo keys', () => {
    expect(seoProblem({})).toBeNull();
    expect(seoProblem(sd(undefined))).toBeNull();
    expect(seoProblem(sd({ 'faq.book': 'Some text with <b>anything</b> (not our business here)' }))).toBeNull();
    expect(seoProblem(sd({ 'seo.home.title': 'Fresh Cuts', 'seo.home.description': '', 'seo.svc.skin fade.title': 'Skin Fade' }))).toBeNull();
    expect(seoProblem(sd({ 'seo.home.title': '   ' }))).toBeNull();
    expect(seoProblem(sd({ 'seo.future.title': 'short unknown key, ignored by the renderer' }))).toBeNull();
  });
  it('refuses hostile, over-long, wrong-typed and too many seo values', () => {
    for (const v of ['<script>alert(1)</script>', 'x'.repeat(61), 'Fresh\nCuts', '💈 cuts', 'BEST BARBER IN TOWN', '!!!!', 'Cut‮d']) expect(seoProblem(sd({ 'seo.home.title': v })), v).not.toBeNull();
    expect(seoProblem(sd({ 'seo.home.description': 'x'.repeat(161) }))).not.toBeNull();
    expect(seoProblem(sd({ 'seo.home.title': 'x'.repeat(10_000) }))).not.toBeNull();
    expect(seoProblem(sd({ 'seo.future.title': 'x'.repeat(SEO_RAW_MAX + 1) }))).not.toBeNull(); // even a key we ignore is size-capped
    expect(seoProblem(sd({ 'seo.home.title': 5 }))).not.toBeNull();
    expect(seoProblem(sd({ 'seo.home.title': null }))).not.toBeNull();
    expect(seoProblem(sd(['x']))).not.toBeNull();
    expect(seoProblem(sd('x'))).not.toBeNull();
    const many: Record<string, string> = {};
    for (let i = 0; i <= MAX_SEO_KEYS; i++) many[`seo.k${i}.title`] = 'ok';
    expect(seoProblem(sd(many))).not.toBeNull();
  });
});

describe('seoDuplicates', () => {
  it('reports pages that share a title or a description, ignoring case and spacing, and nothing else', () => {
    const r = seoDuplicates([
      { id: 'home', title: 'Fresh Cuts', description: 'A' },
      { id: 'about', title: 'fresh  cuts', description: 'b' },
      { id: 'faq', title: 'FAQ', description: 'a ' },
      { id: 'hours', title: 'Hours', description: 'Other' },
      { id: 'x', title: '', description: '' }, { id: 'y', title: '', description: '' },
    ]);
    expect(r.titles).toEqual([['home', 'about']]);
    expect(r.descriptions).toEqual([['home', 'faq']]);
    expect(seoDuplicates([])).toEqual({ titles: [], descriptions: [] });
    expect(seoDuplicates([{ id: 'a', title: 'T', description: 'D' }, { id: 'b', title: 'T2', description: 'D2' }])).toEqual({ titles: [], descriptions: [] });
  });
  it('groups three and keeps the group order', () => {
    expect(seoDuplicates([{ id: 'a', title: 'S', description: '1' }, { id: 'b', title: 'S', description: '2' }, { id: 'c', title: 's', description: '3' }]).titles).toEqual([['a', 'b', 'c']]);
  });
});
