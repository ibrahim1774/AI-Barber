// R1 to R9 (plan 2026-10-24 section 2a): seeded bad strings fail, seeded good strings pass.
import { describe, expect, it } from 'vitest';
import { copyProblems, isKnownToken, serviceWordsIn, VOCAB_GROUPS } from '../../lib/render/copyRules';

const rule = (text: string, opts?: Parameters<typeof copyProblems>[1]) => copyProblems(text, opts).map((p) => p.split(':')[0]);

describe('copyProblems: good strings', () => {
  it.each([
    'A fade blends short hair into longer hair.',
    'Bring a photo of the cut you like.',
    'Most short cuts need a refresh every 2–4 weeks.',
    'The {service} is listed at {price}.',
    'Use the {link:book} link to choose a time.',
    'Skip harsh scrubs for the rest of the day.',
    'What does a little off the top mean?',
    'Say how high you want it: low, mid or high.',
  ])('%s', (s) => {
    expect(copyProblems(s, { allow: ['fade'] })).toEqual([]);
  });
});

describe('seeded bad strings fail the rule they break', () => {
  const cases: [string, string, string][] = [
    ['R1', 'We cut hair with care.', 'we'],
    ['R1', 'Our barbers listen.', 'our'],
    ['R1', 'Let us know early.', 'us'],
    ['R1', "We're open daily.", "we're"],
    ['R2', 'The best fade in town.', 'best'],
    ['R2', 'A top-rated cut.', 'top-rated'],
    ['R2', 'Premium grooming for men.', 'premium'],
    ['R2', 'A friendly team.', 'friendly'],
    ['R2', 'Expert hands.', 'expert'],
    ['R3', 'Cutting hair for years.', 'years'],
    ['R3', 'Since the shop opened.', 'since'],
    ['R3', 'A licensed barber.', 'licensed'],
    ['R3', 'Certified and trained.', 'certified'],
    ['R4', 'Walk-ins are welcome.', 'walk-ins'],
    ['R4', 'Parking is easy.', 'parking'],
    ['R4', 'A free beard oil.', 'free'],
    ['R4', 'We take cash.', 'cash'],
    ['R4', 'Coffee while you wait.', 'coffee'],
    ['R5', 'A guarantee on every cut.', 'guarantee'],
    ['R5', 'A perfect fade.', 'perfect'],
    ['R5', 'Full satisfaction.', 'satisfaction'],
    ['R5', '100% clean.', '100%'],
    ['R6', 'A cut costs 30 dollars.', 'digit'],
    ['R6', 'Come back in 10 minutes.', 'digit'],
    ['R6', 'Every 2–4 months.', 'digit'],
    ['R6', 'An affordable cut.', 'affordable'],
    ['R6', 'A good deal.', 'deal'],
    ['R7', 'A shop near the station.', 'near'],
    ['R7', 'Serving the whole area.', 'serving'],
    ['R7', 'Visit us in Brooklyn.', 'Brooklyn'],
    ['R7', 'Ask for a cut like the ones in Texas.', 'Texas'],
    ['R8', 'A fade is a clipper cut.', 'fade'],
    ['R8', 'A taper is neat.', 'taper'],
    ['R8', 'Ask about the shave.', 'shave'],
    ['R8', 'Bring your kids.', 'kids'],
    ['R8', 'Trim the beard.', 'beard'],
    ['R8', 'Hair color fades.', 'color'],
    ['R9', 'Clients say it is great.', 'clients say'],
    ['R9', 'Read the reviews.', 'reviews'],
    ['R9', 'Five stars.', 'stars'],
    ['R9', 'He said “trim it”.', '“'],
  ];
  it.each(cases)('%s: %s', (id, text) => {
    expect(rule(text), text).toContain(id === 'R1' && text.startsWith('Let') ? 'R1' : id);
  });
  it('flags an unknown token and stray braces', () => {
    expect(copyProblems('Hello {nope}.').join()).toMatch(/unknown/);
    expect(copyProblems('Hello {link:everywhere}.').join()).toMatch(/unknown/);
    expect(copyProblems('Hello {svc:pizza}.').join()).toMatch(/unknown/);
    expect(copyProblems('Hello { oops.').join()).toMatch(/stray/);
  });
});

describe('details', () => {
  it('a digit is allowed only inside a days or weeks range', () => {
    expect(copyProblems('Every 3–5 weeks is typical.')).toEqual([]);
    expect(copyProblems('Every 3–5 days works.')).toEqual([]);
    expect(copyProblems('Every 3 weeks.').join()).toMatch(/R6/);
  });
  it('R8 allows exactly the groups named in `allow`', () => {
    expect(copyProblems('A fade grows out fast.', { allow: ['fade'] })).toEqual([]);
    expect(copyProblems('A fade grows out fast.', { allow: ['taper'] }).join()).toMatch(/R8/);
    expect(copyProblems('A fade or a taper.', { allow: ['fade'] }).join()).toMatch(/taper/);
  });
  it('a service named through {svc:...} is fine in any block', () => {
    expect(copyProblems('Pair it with {svc:fade}.')).toEqual([]);
  });
  it('a capitalised word at the start of a sentence is fine; inside one it is not', () => {
    expect(copyProblems('Start with the length.')).toEqual([]);
    expect(copyProblems('Then ask Sam.').join()).toMatch(/R7/);
  });
  it('known tokens', () => {
    expect(isKnownToken('shop')).toBe(true);
    expect(isKnownToken('link', 'hours')).toBe(true);
    expect(isKnownToken('svc', 'color')).toBe(true);
    expect(isKnownToken('link')).toBe(false);
    expect(isKnownToken('shop', 'x')).toBe(false);
  });
  it('serviceWordsIn lists the groups a text names, tokens excluded', () => {
    expect(serviceWordsIn('A fade and a taper, with {svc:shave}.').sort()).toEqual(['fade', 'taper']);
    expect(VOCAB_GROUPS).toContain('beard');
  });
});

describe('M1: health, hygiene and cost words, ASCII only, range cap, #1', () => {
  it.each([
    ['R10', 'This cures dandruff.'], ['R10', 'Helps hair regrow thicker.'], ['R10', 'It is safe for babies.'], ['R10', 'Treatment for hair loss.'], ['R10', 'It can prevent breakage.'], ['R10', 'Good for hair growth.'],
    ['R4', 'Sterile tools every time.'], ['R4', 'Tools are disinfected between visits.'], ['R4', 'Clean, hygienic tools.'], ['R4', 'At no cost.'], ['R4', 'Done on the house.'], ['R4', 'No charge for kids.'],
    ['R4', 'Open every day of the week.'], ['R4', 'Open 24/7.'], ['R4', 'Low prices all round.'],
    ['R2', '#1 for fades.'],
  ])('%s: %s', (id, text) => { expect(rule(text), text).toContain(id); });
  it('non-ASCII text is refused, apart from the apostrophe and dashes', () => {
    expect(rule('Our best Bеard care.')).toContain('R11'); // Cyrillic e
    expect(rule('Fresh cut é')).toContain('R11');
    expect(copyProblems('A kids’ cut every 4–6 weeks — it varies.', { allow: ['kids-cut'] })).toEqual([]);
  });
  it('advice ranges need both numbers at 12 or less', () => {
    expect(rule('Come back in 1-100 weeks.')).toContain('R6');
    expect(rule('Come back in 2–40 weeks.')).toContain('R6');
    expect(rule('Come back in 2–4 weeks.')).toEqual([]);
    expect(rule('Come back in 6–12 weeks.')).toEqual([]);
  });
});
