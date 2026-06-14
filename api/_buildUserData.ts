import {
  hashEmail,
  hashPhone,
  hashFirstName,
  hashLastName,
  hashCity,
  hashState,
  hashZip,
  hashCountry,
  hashExternalId,
} from './_hashPii.js';

// Builds the Meta CAPI `user_data` object from raw match params.
// Every field beyond em/ph drives Event Match Quality in Events
// Manager — fbc +32%, fbp +24%, external_id +24%, fn/ln/ct/st/zp
// each +14%. We accept null/undefined for every field and only
// include the keys we can actually populate, so Meta never sees
// empty strings (which it counts against match quality).

export interface MatchInputs {
  email?: string | null;
  phone?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  country?: string | null;
  externalId?: string | null;
  fbc?: string | null; // raw _fbc cookie value
  fbp?: string | null; // raw _fbp cookie value
  clientIp?: string | null;
  clientUserAgent?: string | null;
}

export function buildUserData(inp: MatchInputs): Record<string, any> {
  const ud: Record<string, any> = {};

  const em = hashEmail(inp.email);
  if (em) ud.em = [em];

  const ph = hashPhone(inp.phone);
  if (ph) ud.ph = [ph];

  const fn = hashFirstName(inp.firstName);
  if (fn) ud.fn = [fn];

  const ln = hashLastName(inp.lastName);
  if (ln) ud.ln = [ln];

  const ct = hashCity(inp.city);
  if (ct) ud.ct = [ct];

  const st = hashState(inp.state);
  if (st) ud.st = [st];

  const zp = hashZip(inp.zip);
  if (zp) ud.zp = [zp];

  const country = hashCountry(inp.country);
  if (country) ud.country = [country];

  const eid = hashExternalId(inp.externalId);
  if (eid) ud.external_id = [eid];

  // fbc / fbp are NOT hashed — Meta wants the raw cookie value.
  if (inp.fbc) ud.fbc = inp.fbc;
  if (inp.fbp) ud.fbp = inp.fbp;

  if (inp.clientIp) ud.client_ip_address = inp.clientIp;
  if (inp.clientUserAgent) ud.client_user_agent = inp.clientUserAgent;

  return ud;
}

// Helper: pulls the first forwarded IP from common reverse-proxy
// headers. Vercel uses x-forwarded-for, with the original client IP
// in the first comma-separated slot.
export function extractClientIp(headers: Record<string, any>): string {
  const fwd = headers['x-forwarded-for'];
  if (fwd) {
    const first = Array.isArray(fwd) ? fwd[0] : String(fwd).split(',')[0];
    if (first) return first.trim();
  }
  const real = headers['x-real-ip'];
  if (real) return Array.isArray(real) ? real[0] : String(real);
  return '';
}
