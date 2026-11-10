import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

// The /10 and /20 rewrites are the on/off switch of the price test (rollback: remove only these four entries).
const cfg = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8'));
const rewrites: any[] = cfg.rewrites;

describe('vercel.json price test rewrites', () => {
  it('/10 and /20 (with and without slash) serve the app on www.primebarber.org only, ahead of the catch-all', () => {
    const catchAll = rewrites.findIndex((r) => r.destination === '/index.html');
    for (const src of ['/10', '/10/', '/20', '/20/']) {
      const i = rewrites.findIndex((r) => r.source === src);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(catchAll);
      expect(rewrites[i].destination).toBe('https://prime-barber-web.vercel.app/app/');
      expect(rewrites[i].has).toEqual([{ type: 'host', value: 'www.primebarber.org' }]);
    }
  });
});
