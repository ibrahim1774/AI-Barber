import { shareMessage } from '@/lib/share';

describe('shareMessage', () => {
  it('names the shop for the website', () => {
    expect(shareMessage('website', 'Fade Lab', 'https://fade.vercel.app')).toBe(
      "Check out Fade Lab's new website: https://fade.vercel.app",
    );
  });

  it('falls back to "our" with no shop name', () => {
    expect(shareMessage('website', '  ', 'https://fade.vercel.app')).toBe(
      'Check out our new website: https://fade.vercel.app',
    );
  });

  it('contains the URL exactly once', () => {
    const url = 'https://fade.vercel.app';
    expect(shareMessage('website', 'Fade Lab', url).split(url)).toHaveLength(2);
    expect(shareMessage('website', '', url).split(url)).toHaveLength(2);
  });
});
