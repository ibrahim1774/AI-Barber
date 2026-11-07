import { describe, it, expect, vi } from 'vitest';
import { isSuppressed, suppress } from '../../lib/webApp/suppressions.js';

const err = (status: number) => Object.assign(new Error(`supabase ${status}`), { status });

describe('suppressions', () => {
  it('suppress lowercases, trims and ignores duplicates server-side', async () => {
    const rest = vi.fn(async () => null);
    expect(await suppress('  Jake@Gmail.COM ', 'unsubscribe', 'one-click', 'u1', rest as any)).toBe(true);
    const [path, init] = rest.mock.calls[0] as any;
    expect(path).toBe('web_app_email_suppressions?on_conflict=email');
    expect(init.prefer).toContain('resolution=ignore-duplicates');
    expect(init.body).toEqual({ email: 'jake@gmail.com', reason: 'unsubscribe', source: 'one-click', user_id: 'u1' });
  });
  it('omits user_id when unknown', async () => {
    const rest = vi.fn(async () => null);
    await suppress('a@b.co', 'bounce', 'resend:email.bounced', undefined, rest as any);
    expect((rest.mock.calls[0] as any)[1].body).not.toHaveProperty('user_id');
  });
  it('isSuppressed queries the lowercased, encoded address', async () => {
    const rest = vi.fn(async () => [{ email: 'a+b@c.co' }]);
    expect(await isSuppressed('A+B@C.co', rest as any)).toBe(true);
    expect((rest.mock.calls[0] as any)[0]).toContain('email=eq.a%2Bb%40c.co');
    expect(await isSuppressed('x@y.co', (async () => []) as any)).toBe(false);
  });
  it('fails soft when the table is missing (404)', async () => {
    const rest = vi.fn(async () => { throw err(404); });
    expect(await isSuppressed('a@b.co', rest as any)).toBe(false);
    expect(await suppress('a@b.co', 'complaint', 's', null, rest as any)).toBe(false);
  });
  it('other errors throw, so an outage never reads as "not suppressed"', async () => {
    const rest = vi.fn(async () => { throw err(500); });
    await expect(isSuppressed('a@b.co', rest as any)).rejects.toThrow();
    await expect(suppress('a@b.co', 'bounce', 's', null, rest as any)).rejects.toThrow();
  });
});
