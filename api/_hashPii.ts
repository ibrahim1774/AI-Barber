import { createHash } from 'crypto';

// SHA-256 lowercased + trimmed PII hashing — required format for
// Meta and TikTok advanced matching. Both platforms expect the same
// canonical input ("trim → lowercase → sha256 hex") so the same hash
// matches a user in either system.

const sha256Hex = (input: string): string =>
  createHash('sha256').update(input).digest('hex');

export function hashEmail(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const clean = raw.trim().toLowerCase();
  if (!clean.includes('@')) return null;
  return sha256Hex(clean);
}

// E.164-ish normalization. Strip everything except digits, then send.
// Meta + TikTok both want the country code; if the customer's input
// was a 10-digit US number, prepend "1" so the hash matches the same
// canonical form across platforms.
export function hashPhone(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null;
  let digits = raw.replace(/\D+/g, '');
  if (!digits) return null;
  // US default: 10-digit → prepend "1"
  if (digits.length === 10) digits = '1' + digits;
  return sha256Hex(digits);
}
