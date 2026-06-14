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
  if (digits.length === 10) digits = '1' + digits;
  return sha256Hex(digits);
}

// Generic lower+trim+sha256 used for fn/ln/ct/st names.
function hashLower(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const clean = raw.trim().toLowerCase().replace(/\s+/g, '');
  if (!clean) return null;
  return sha256Hex(clean);
}

export const hashFirstName = hashLower;
export const hashLastName = hashLower;
export const hashCity = hashLower;

// US state: Meta wants the 2-letter code, lowercased then sha256.
export function hashState(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const clean = raw.trim().toLowerCase();
  if (!clean) return null;
  // If the caller gave us a full state name we'd ideally map to the
  // 2-letter code, but Stripe addresses already store the short code
  // for US addresses, so a plain lowercase passes Meta's validation.
  return sha256Hex(clean);
}

// Postcode: US zips need just the 5-digit prefix, lowercased.
export function hashZip(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const clean = raw.trim().toLowerCase().split('-')[0].split(' ')[0];
  if (!clean) return null;
  return sha256Hex(clean);
}

// Country: 2-letter ISO code (us, ca, gb…), lowercased.
export function hashCountry(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const clean = raw.trim().toLowerCase();
  if (!clean) return null;
  return sha256Hex(clean);
}

// External ID: Meta wants an opaque, hashed customer identifier.
// We use the Stripe session id (already opaque, already unique per
// purchase) so the matching is deterministic without exposing PII.
export function hashExternalId(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const clean = raw.trim();
  if (!clean) return null;
  return sha256Hex(clean);
}

// Stripe gives us a single "John Q Doe" string. Meta wants fn + ln
// separately. Last token = surname, rest joined = given name.
export function splitName(full: string | null | undefined): { first: string | null; last: string | null } {
  if (!full || typeof full !== 'string') return { first: null, last: null };
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: null, last: null };
  if (parts.length === 1) return { first: parts[0], last: null };
  const last = parts[parts.length - 1];
  const first = parts.slice(0, -1).join(' ');
  return { first, last };
}
