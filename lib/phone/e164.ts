// Server twin of the web app's src/lib/phone.ts. No libphonenumber: strip formatting, then
//   '+' prefix  -> international, 8-15 digits
//   10 digits   -> US/CA, +1 added
//   11 digits starting with 1 -> +1 already there
//   anything else -> invalid
export type PhoneResult =
  | { ok: true; e164: string }
  | { ok: false; reason: 'empty' | 'too_short' | 'too_long' | 'invalid' };

export function normalizePhoneE164(raw: unknown, defaultRegion: 'US' = 'US'): PhoneResult {
  if (typeof raw !== 'string') return { ok: false, reason: 'empty' };
  const s = raw.trim();
  if (!s) return { ok: false, reason: 'empty' };
  // Only formatting characters are allowed besides digits (and one leading '+'); letters or other symbols are invalid.
  if (!/^\+?[\d\s().\-]+$/.test(s)) return { ok: false, reason: 'invalid' };
  const international = s.startsWith('+');
  const digits = s.replace(/\D/g, '');
  if (!digits) return { ok: false, reason: 'empty' };
  if (international) {
    if (digits.length < 8) return { ok: false, reason: 'too_short' };
    if (digits.length > 15) return { ok: false, reason: 'too_long' };
    if (digits[0] === '0') return { ok: false, reason: 'invalid' };
    if (digits[0] === '1' && digits.length !== 11) return { ok: false, reason: digits.length < 11 ? 'too_short' : 'too_long' };
    return { ok: true, e164: `+${digits}` };
  }
  void defaultRegion; // only US for now
  if (digits.length < 10) return { ok: false, reason: 'too_short' };
  if (digits.length === 10) return digits[0] === '0' || digits[0] === '1' ? { ok: false, reason: 'invalid' } : { ok: true, e164: `+1${digits}` };
  if (digits.length === 11 && digits[0] === '1') return digits[1] === '0' || digits[1] === '1' ? { ok: false, reason: 'invalid' } : { ok: true, e164: `+${digits}` };
  return { ok: false, reason: digits.length > 15 ? 'too_long' : 'invalid' };
}
