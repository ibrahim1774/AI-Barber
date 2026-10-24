import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import handler from '../api/create-portal-session.js';

describe('create-portal-session is retired', () => {
  it('answers 410 Gone for any request and never calls Stripe', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    for (const body of [{}, { customerId: 'cus_victim0001' }]) {
      const res: any = { status: vi.fn(() => res), json: vi.fn(() => res), end: vi.fn(() => res) };
      await handler({ method: 'POST', headers: { authorization: 'Bearer x' }, body }, res);
      expect(res.status).toHaveBeenCalledWith(410);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    const src = fs.readFileSync(path.join(process.cwd(), 'api/create-portal-session.ts'), 'utf8');
    expect(src).not.toMatch(/stripe\.com|billing_portal|customerId/);
  });
});
