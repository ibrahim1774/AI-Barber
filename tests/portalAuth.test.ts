import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { resolvePortalCustomer, type PortalDeps } from '../lib/portalAuth.js';
import { ADMIN_EMAIL } from '../lib/admin/auth.js';

const users: Record<string, any> = {
  barber: { id: 'u1', email: 'Barber@Example.com', emailVerified: true },
  unverified: { id: 'u2', email: 'x@example.com', emailVerified: false },
  admin: { id: 'a', email: ADMIN_EMAIL, emailVerified: true },
};
const deps = (over: Partial<PortalDeps> = {}): PortalDeps => ({
  userOf: vi.fn(async (t: string) => users[t] ?? null),
  customersByEmail: vi.fn(async (e: string) => (e === 'barber@example.com' ? [{ id: 'cus_old000001', created: 1 }, { id: 'cus_new000002', created: 2 }] : [])),
  ...over,
});

describe('create-portal-session: only the caller\'s own Stripe customer', () => {
  it('no or bad token → 401', async () => {
    expect(await resolvePortalCustomer({}, deps())).toEqual({ ok: false, status: 401, error: 'sign-in-required' });
    expect((await resolvePortalCustomer({ authorization: 'Bearer junk' }, deps())).status).toBe(401);
  });

  it("the customer is derived from the caller's verified email; a customerId from the browser is ignored", async () => {
    const d = deps();
    expect(await resolvePortalCustomer({ authorization: 'Bearer barber', customerId: 'cus_victim0001' }, d)).toEqual({ ok: true, customer: 'cus_new000002' });
    expect(d.customersByEmail).toHaveBeenCalledWith('barber@example.com');
  });

  it('unverified email → 403; no billing account → 404', async () => {
    expect((await resolvePortalCustomer({ authorization: 'Bearer unverified' }, deps())).status).toBe(403);
    const d = deps({ userOf: vi.fn(async () => ({ id: 'u3', email: 'new@example.com', emailVerified: true })) });
    expect((await resolvePortalCustomer({ authorization: 'Bearer x' }, d)).status).toBe(404);
  });

  it('the admin may open any named customer', async () => {
    expect(await resolvePortalCustomer({ authorization: 'Bearer admin', customerId: 'cus_any0000001' }, deps())).toEqual({ ok: true, customer: 'cus_any0000001' });
  });

  it('lookup errors fail closed (503)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await resolvePortalCustomer({ authorization: 'Bearer barber' }, deps({ userOf: vi.fn(async () => { throw new Error('down'); }) }))).status).toBe(503);
    expect((await resolvePortalCustomer({ authorization: 'Bearer barber' }, deps({ customersByEmail: vi.fn(async () => { throw new Error('down'); }) }))).status).toBe(503);
  });

  it('the handler never reads customerId for the portal except through resolvePortalCustomer; first-party CORS', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'api/create-portal-session.ts'), 'utf8');
    expect(src).toMatch(/resolvePortalCustomer/);
    expect(src).toMatch(/setFirstPartyCors/);
    expect(src).not.toMatch(/Access-Control-Allow-Origin', '\*'/);
    expect(src).toMatch(/customer: auth\.customer/);
  });
});
