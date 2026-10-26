// One phone -> tel: href normaliser for every design (spec: E.164 where we can tell the country).
// "+1 (512) 555-0199" / "1-512-555-0199" / "512.555.0199" -> tel:+15125550199; "+44 20 7946 0958" -> tel:+442079460958.
// Fewer than 7 digits -> '' (no link). 7-9 digits (a local number, country unknown) dials as typed.

/** The `tel:` href for a stored phone, or '' when there is nothing dialable. */
export function telHref(phone: unknown): string {
  const raw = typeof phone === 'string' ? phone.trim() : '';
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return '';
  if (raw.startsWith('+')) return `tel:+${digits}`;
  if (raw.startsWith('00') && digits.length > 9) return `tel:+${digits.slice(2)}`;
  if (digits.length === 10) return `tel:+1${digits}`;
  if (digits.length === 11 && digits[0] === '1') return `tel:+${digits}`;
  if (digits.length >= 11) return `tel:+${digits}`;
  return `tel:${digits}`;
}
