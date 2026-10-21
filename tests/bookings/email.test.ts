import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { sendMail, createTransport } = vi.hoisted(() => {
  const sendMail = vi.fn();
  return { sendMail, createTransport: vi.fn(() => ({ sendMail })) };
});
vi.mock('nodemailer', () => ({ default: { createTransport } }));

import { sendEmail, escapeHtml, cleanDisplayName } from '../../lib/bookings/email.js';

const ENV = { SMTP_HOST: 'smtp.gmail.com', SMTP_PORT: '465', SMTP_USER: 'support@davoxa.com', SMTP_PASS: 'pw', SMTP_FROM: 'support@davoxa.com' };
const msg = { to: 'sam@example.com', subject: 'Hi', html: '<p>x</p>', fromName: 'Fade "Factory" via AI Barber', replyTo: 'owner@example.com' };

describe('sendEmail', () => {
  const saved = { ...process.env };
  beforeEach(() => { sendMail.mockReset(); createTransport.mockClear(); Object.assign(process.env, ENV); vi.spyOn(console, 'warn').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {}); });
  afterEach(() => { process.env = { ...saved }; vi.restoreAllMocks(); });

  it('skips (never throws) when SMTP env is missing', async () => {
    delete process.env.SMTP_PASS;
    expect(await sendEmail(msg)).toBe('skipped');
    expect(createTransport).not.toHaveBeenCalled();
  });

  it('sends with the shop display name, SMTP_FROM address and reply-to; port 465 is secure', async () => {
    sendMail.mockResolvedValue({});
    expect(await sendEmail({ ...msg, attachments: [{ filename: 'booking.ics', content: 'X', contentType: 'text/calendar' }] })).toBe('sent');
    expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({
      host: 'smtp.gmail.com', port: 465, secure: true, auth: { user: 'support@davoxa.com', pass: 'pw' },
      connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000,
    }));
    const opts = sendMail.mock.calls[0][0];
    expect(opts.from).toEqual({ name: 'Fade Factory via AI Barber', address: 'support@davoxa.com' });
    expect(opts.replyTo).toBe('owner@example.com');
    expect(opts.attachments).toHaveLength(1);
  });

  it('returns failed (never throws) on transport errors', async () => {
    const t = { sendMail: vi.fn().mockRejectedValue(new Error('535 auth')) };
    expect(await sendEmail(msg, t)).toBe('failed');
  });

  it('skips invalid recipients and drops invalid reply-to', async () => {
    const t = { sendMail: vi.fn().mockResolvedValue({}) };
    expect(await sendEmail({ ...msg, to: 'not-an-email' }, t)).toBe('skipped');
    expect(await sendEmail({ ...msg, replyTo: 'bad\r\nBcc: x@y.z' }, t)).toBe('sent');
    expect(t.sendMail.mock.calls[0][0].replyTo).toBeUndefined();
  });

  it('strips CR/LF from the subject (no header injection)', async () => {
    const t = { sendMail: vi.fn().mockResolvedValue({}) };
    await sendEmail({ ...msg, subject: 'Hi\r\nBcc: x@y.z' }, t);
    expect(t.sendMail.mock.calls[0][0].subject).toBe('Hi Bcc: x@y.z');
  });

  it('escapes HTML and cleans header names', () => {
    expect(escapeHtml(`<a href="x">'&`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;');
    expect(cleanDisplayName('A\r\nBcc: <x>')).toBe('A Bcc: x');
  });
});
