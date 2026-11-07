// Resend webhooks (Svix-signed). Hard bounces and complaints go on the suppression list so a bad address never gets
// a second reminder. Everything else is acknowledged and ignored. Bodies and addresses are never logged.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { suppress } from './suppressions.js';

export const SVIX_TOLERANCE_SEC = 300;

/** Svix: HMAC-SHA256 over `${id}.${timestamp}.${body}` keyed with the base64 part of `whsec_...`; header lists `v1,<sig>` entries. */
export function verifySvix(rawBody: string, h: { id?: unknown; timestamp?: unknown; signature?: unknown }, secret: string, nowSec = Math.floor(Date.now() / 1000)): boolean {
  if (!secret || typeof h.id !== 'string' || typeof h.timestamp !== 'string' || typeof h.signature !== 'string') return false;
  const ts = Number(h.timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowSec - ts) > SVIX_TOLERANCE_SEC) return false;
  const key = Buffer.from(secret.startsWith('whsec_') ? secret.slice(6) : secret, 'base64');
  if (!key.length) return false;
  const expected = createHmac('sha256', key).update(`${h.id}.${h.timestamp}.${rawBody}`).digest();
  let ok = false;
  for (const part of h.signature.split(' ')) {
    const [ver, sig] = part.split(',');
    if (ver !== 'v1' || !sig) continue;
    const given = Buffer.from(sig, 'base64');
    if (given.length === expected.length && timingSafeEqual(given, expected)) ok = true; // no early exit: constant work per entry
  }
  return ok;
}

type Suppress = typeof suppress;
/** Returns how many addresses were suppressed. Throws on a database error (the caller answers 5xx so Resend retries). */
export async function handleResendEvent(event: any, doSuppress: Suppress = suppress): Promise<{ handled: boolean; suppressed: number; tableMissing?: boolean }> {
  const type = event?.type;
  let reason: 'bounce' | 'complaint';
  if (type === 'email.complained') reason = 'complaint';
  else if (type === 'email.bounced' && String(event?.data?.bounce?.type ?? '').toLowerCase() === 'permanent') reason = 'bounce';
  else return { handled: false, suppressed: 0 };
  const to: unknown[] = Array.isArray(event?.data?.to) ? event.data.to : [];
  let n = 0;
  for (const addr of to) {
    if (typeof addr !== 'string') continue;
    const email = addr.match(/<([^>]+)>/)?.[1] ?? addr; // "Name <a@b.co>" or bare
    if (!email.includes('@')) continue;
    if (!(await doSuppress(email, reason, `resend:${type}`))) return { handled: true, suppressed: n, tableMissing: true };
    n++;
  }
  return { handled: true, suppressed: n };
}
