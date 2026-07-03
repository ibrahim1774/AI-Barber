// Ad-click attribution capture.
//
// Facebook ads land on our subpages with tracking params appended, e.g.
//   ?tw_source={{site_source_name}}&tw_adid={{ad.id}}&tw_campaign={{campaign.name}}
// (tw_* are Triple Whale's params; utm_* / fbclid / ttclid / gclid are the
// standard click ids). We capture whatever is present on the landing URL and
// persist it so it can be attached to:
//   • the Lead (services/leadCaptureService → Make.com), read via getAdAttribution()
//   • the Purchase (api/create-checkout-session → Stripe metadata), read
//     server-side from the `aib_attr` cookie this module writes.
//
// So each lead + sale carries which campaign/ad drove it. Generic by design —
// add more tw_*/utm_* params to your ad URL and they flow through automatically.

const STORAGE_KEY = 'aibarber_ad_attribution';
const COOKIE_NAME = 'aib_attr';
const COOKIE_MAX_AGE_DAYS = 30;

// Param keys we forward (anything else on the URL is ignored).
function isTrackingParam(key: string): boolean {
  const k = key.toLowerCase();
  return (
    k.startsWith('tw_') ||
    k.startsWith('utm_') ||
    k === 'fbclid' ||
    k === 'ttclid' ||
    k === 'gclid'
  );
}

function collectFromUrl(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const params = new URLSearchParams(window.location.search);
  const out: Record<string, string> = {};
  params.forEach((value, key) => {
    if (value && isTrackingParam(key)) {
      out[key.toLowerCase()] = value.slice(0, 500); // Stripe metadata value cap
    }
  });
  return out;
}

// Call once per app load (covers every subpage — App renders for all routes).
// Last-touch: if the current URL carries ad params, they replace the stored
// set (the ad most recently clicked); if it doesn't, the previously stored set
// survives internal navigation to the form / checkout.
export function captureAdParamsOnLoad(): void {
  if (typeof window === 'undefined') return;
  try {
    const fresh = collectFromUrl();
    if (Object.keys(fresh).length === 0) return;
    const record = {
      ...fresh,
      landing_path: window.location.pathname,
      captured_at: new Date().toISOString(),
    };
    const json = JSON.stringify(record);
    try { localStorage.setItem(STORAGE_KEY, json); } catch { /* ignore */ }
    // Cookie so same-origin API routes (checkout) can read it server-side
    // without threading the params through every client fetch.
    document.cookie =
      `${COOKIE_NAME}=${encodeURIComponent(json)}; path=/; max-age=${COOKIE_MAX_AGE_DAYS * 24 * 60 * 60}; SameSite=Lax`;
  } catch {
    /* storage/cookies unavailable — attribution is best-effort */
  }
}

// Client-side read (used when building the Lead payload).
export function getAdAttribution(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}
