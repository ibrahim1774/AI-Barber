import { describe, it, expect, vi } from 'vitest';

const calls = vi.hoisted(() => [] as any[]);
vi.mock('../../lib/webApp/webAppServer.js', () => ({ sbRest: vi.fn(), stripeCall: async (...a: any[]) => { calls.push(a); return {}; } }));
vi.mock('../../lib/webApp/emails.js', () => ({ alertOwner: vi.fn(), duplicateRefundEmail: vi.fn(), sendMail: vi.fn() }));
vi.mock('../../lib/webApp/dunning.js', () => ({ contactFor: vi.fn() }));

import { liveDupDeps } from '../../lib/webApp/duplicates.js';

describe('liveDupDeps', () => {
  it('cancels with a plain DELETE (no prorate param) and a per-duplicate idempotency key', async () => {
    await liveDupDeps('test').cancel('sub_x');
    expect(calls[0]).toEqual(['subscriptions/sub_x', null, 'DELETE', { idempotencyKey: 'aibarber-app:dup-cancel:sub_x' }]);
  });
});
