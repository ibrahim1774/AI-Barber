import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sendMail } from '../../lib/webApp/emails.js';
import { sendOwnerEmail } from '../../lib/webApp/ownerNotify.js';

const mail = { subject: 's', html: '<p>x</p>', text: 'x' };
const res = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
beforeEach(() => { vi.stubEnv('RESEND_API_KEY', 'k'); vi.spyOn(console, 'info').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe('sendMail', () => {
  it('returns the Resend message id', async () => {
    const f = vi.fn(async () => res(200, { id: 'msg_1' }));
    expect(await sendMail('a@b.co', mail, f as any)).toBe('msg_1');
  });
  it('a 2xx without a message id is not "accepted"', async () => {
    const f = vi.fn(async () => res(200, {}));
    await expect(sendMail('a@b.co', mail, f as any)).rejects.toThrow(/message id/);
  });
  it('retries once on 429 (an order fires several mails at once)', async () => {
    vi.useFakeTimers();
    const f = vi.fn().mockResolvedValueOnce(res(429, {})).mockResolvedValueOnce(res(200, { id: 'msg_2' }));
    const p = sendMail('a@b.co', mail, f as any);
    await vi.advanceTimersByTimeAsync(1200);
    expect(await p).toBe('msg_2');
    expect(f).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
  it('the retry reuses the same Idempotency-Key (no double send)', async () => {
    vi.useFakeTimers();
    const f = vi.fn().mockResolvedValueOnce(res(503, {})).mockResolvedValueOnce(res(200, { id: 'msg_3' }));
    const p = sendMail('a@b.co', mail, f as any);
    await vi.advanceTimersByTimeAsync(1200);
    await p;
    const k = (i: number) => (f.mock.calls[i][1] as any).headers['Idempotency-Key'];
    expect(k(0)).toBeTruthy(); expect(k(1)).toBe(k(0));
    vi.useRealTimers();
  });
  it('still throws on a persistent error', async () => {
    const f = vi.fn(async () => res(403, {}));
    await expect(sendMail('a@b.co', mail, f as any)).rejects.toThrow('resend 403');
  });
});

describe('sendOwnerEmail logs "sent" only on acceptance', () => {
  const ev = { kind: 'order_created', customerName: 'S', itemCount: 1, totalCents: 700, fulfilment: 'shipping', orderLabel: '#1001', shipTo: '123 Main St' } as const;
  it('logs the message id when accepted', async () => {
    const out = await sendOwnerEmail('o', ev as any, { contact: async () => ({ email: 'o@x.co', firstName: null }), send: async () => 'msg_9' });
    expect(out).toBe('sent');
    expect(console.info).toHaveBeenCalledWith('[web-app owner notify] sent', { kind: 'order_created', messageId: 'msg_9' });
  });
  it('does not log "sent" when the provider gives no id', async () => {
    const f = vi.fn(async () => res(200, {}));
    const out = await sendOwnerEmail('o', ev as any, { contact: async () => ({ email: 'o@x.co', firstName: null }), send: (to, m) => sendMail(to, m, f as any) });
    expect(out).toBe('failed');
    expect(console.info).not.toHaveBeenCalledWith('[web-app owner notify] sent', expect.anything());
  });
});
