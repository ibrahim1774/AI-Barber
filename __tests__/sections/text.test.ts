import { cleanText } from '@/lib/sections/text';

describe('cleanText', () => {
  it('strips angle brackets and trims', () => {
    expect(cleanText('  <b>Fade</b> ')).toBe('bFade/b');
  });
  it('keeps ordinary punctuation', () => {
    expect(cleanText("Mike's Cut & Shave")).toBe("Mike's Cut & Shave");
  });
});

test('smart quotes typed on iOS are straightened so names match the page', () => {
  const { straightenQuotes, cleanText } = require('@/lib/sections/text');
  expect(straightenQuotes('Jack\u2019s \u2018Cuts\u2019')).toBe("Jack's 'Cuts'");
  expect(cleanText(' Jack\u2019s <b>')).toBe("Jack's b");
});
