import nodemailer from 'nodemailer';

/**
 * Transactional email over SMTP (Google Workspace, support@davoxa.com).
 * Env: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM.
 *
 * sendEmail never throws. With any env value missing it logs and returns 'skipped';
 * a transport error is logged and returns 'failed'.
 */

export interface EmailAttachment {
  filename: string;
  content: string;
  contentType: string;
}

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text?: string;
  /** Display name of the sender, e.g. "Fade Factory via Prime Barber". The address is always SMTP_FROM. */
  fromName?: string;
  replyTo?: string | null;
  attachments?: EmailAttachment[];
}

export type EmailResult = 'sent' | 'skipped' | 'failed';

/** The slice of a nodemailer transport we use (lets tests inject a fake). */
export interface MailTransport {
  sendMail(opts: Record<string, unknown>): Promise<unknown>;
}

interface SmtpEnv { host: string; port: number; user: string; pass: string; from: string }

function smtpEnv(): SmtpEnv | null {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || !SMTP_FROM) return null;
  const port = Number(SMTP_PORT || 465);
  return { host: SMTP_HOST, port: Number.isFinite(port) && port > 0 ? port : 465, user: SMTP_USER, pass: SMTP_PASS, from: SMTP_FROM };
}

let cached: { key: string; transport: MailTransport } | null = null;

function liveTransport(env: SmtpEnv): MailTransport {
  const key = `${env.host}:${env.port}:${env.user}`;
  if (cached?.key === key) return cached.transport;
  const transport = nodemailer.createTransport({
    host: env.host,
    port: env.port,
    secure: env.port === 465, // 465 = implicit TLS; 587 upgrades with STARTTLS
    auth: { user: env.user, pass: env.pass },
    // Fail fast instead of nodemailer's 2-minute connect / 10-minute idle defaults.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    // Reuse one connection across a cron batch.
    pool: true,
    maxConnections: 1,
  }) as unknown as MailTransport;
  cached = { key, transport };
  return transport;
}

/** Header-safe display name: no CR/LF, no quotes or angle brackets, bounded length. */
export function cleanDisplayName(name: string): string {
  return String(name).replace(/[\r\n"<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
}

const EMAIL_RE = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/;
export const isEmail = (s: unknown): s is string => typeof s === 'string' && s.length <= 254 && EMAIL_RE.test(s);

export async function sendEmail(msg: EmailMessage, transport?: MailTransport): Promise<EmailResult> {
  try {
    const env = smtpEnv();
    if (!env) {
      console.warn('[bookings/email] SMTP env missing; skipped:', msg.subject);
      return 'skipped';
    }
    if (!isEmail(msg.to)) {
      console.warn('[bookings/email] invalid recipient; skipped');
      return 'skipped';
    }
    const t = transport ?? liveTransport(env);
    await t.sendMail({
      from: { name: cleanDisplayName(msg.fromName || 'Prime Barber'), address: env.from },
      to: msg.to,
      ...(msg.replyTo && isEmail(msg.replyTo) ? { replyTo: msg.replyTo } : {}),
      subject: msg.subject.replace(/[\r\n]+/g, ' '),
      html: msg.html,
      ...(msg.text ? { text: msg.text } : {}),
      ...(msg.attachments?.length ? { attachments: msg.attachments } : {}),
    });
    return 'sent';
  } catch (e: any) {
    console.error('[bookings/email] send failed:', e?.message || e);
    return 'failed';
  }
}

/** Escape a value for HTML text or a double-quoted attribute. */
export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
