import { cleanText } from '@/lib/sections/text';

describe('cleanText', () => {
  it('strips angle brackets and trims', () => {
    expect(cleanText('  <b>Fade</b> ')).toBe('bFade/b');
  });
  it('keeps ordinary punctuation', () => {
    expect(cleanText("Mike's Cut & Shave")).toBe("Mike's Cut & Shave");
  });
});
