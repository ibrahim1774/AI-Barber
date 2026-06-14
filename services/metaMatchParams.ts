// Reads Meta advanced-matching cookies that the Facebook pixel sets on
// the browser side and reshapes them into the shape our CAPI endpoints
// expect. Including these in every server-side event lifts Event Match
// Quality in Events Manager:
//   fbc  (Click ID)  +32%
//   fbp  (Browser ID) +24%
// _fbc is only set when the visitor hit a page with `?fbclid=…` in the
// URL. If the cookie isn't there but the URL still carries fbclid we
// synthesize a valid _fbc value per Meta's spec
// (`fb.1.<unix-ms>.<fbclid>`) so the very first page-view also benefits.

function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(
    new RegExp('(^|;\\s*)' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '=([^;]*)')
  );
  return match ? decodeURIComponent(match[2]) : null;
}

function readFbclidFromUrl(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get('fbclid');
  } catch {
    return null;
  }
}

export interface MetaMatchParams {
  fbc: string | null;
  fbp: string | null;
}

export function readMetaCookies(): MetaMatchParams {
  const fbp = getCookie('_fbp');
  let fbc = getCookie('_fbc');
  if (!fbc) {
    const fbclid = readFbclidFromUrl();
    if (fbclid) fbc = `fb.1.${Date.now()}.${fbclid}`;
  }
  return { fbc, fbp };
}

// Stripe gives us a single "John Q Doe" string. Meta wants fn + ln
// separately for the +14% / +14% match-quality boosts.
export function splitName(full: string | null | undefined): { firstName: string | null; lastName: string | null } {
  if (!full || typeof full !== 'string') return { firstName: null, lastName: null };
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: null, lastName: null };
  if (parts.length === 1) return { firstName: parts[0], lastName: null };
  return {
    firstName: parts.slice(0, -1).join(' '),
    lastName: parts[parts.length - 1],
  };
}
