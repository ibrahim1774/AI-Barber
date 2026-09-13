import type { VercelRequest, VercelResponse } from '@vercel/node';

// Business-name suggestions for the homepage Google Business importer.
//
// Server-side on purpose: a BROWSER Places key would have to be
// referrer-locked (and would sit in the client bundle). The server key
// has no referrer restriction and never leaves the function.
//
// DEGRADED MODE — the AI-Barber Vercel project does not currently have
// GOOGLE_PLACES_SERVER_KEY. Every failure path (no key, bad key, quota,
// upstream 5xx, network) returns HTTP 200 with an empty `suggestions`
// array plus a readable `error` string. Suggestions are a convenience:
// "Find my business" (Apify-backed) and the manual form both still work
// without them, so a 4xx/5xx here would read as a hard failure the
// funnel doesn't actually have.
export const config = { maxDuration: 15 };

const NO_KEY_MESSAGE =
  "Name suggestions are unavailable right now — type your full shop name and city (e.g. \"Fade Factory, Houston\") and tap Find my business.";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // GET = warm-up ping from the importer page (fired on first keystroke).
  if (req.method === 'GET') return res.status(200).json({ ok: true, warm: true });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const key = process.env.GOOGLE_PLACES_SERVER_KEY || process.env.GOOGLE_PLACES_KEY || '';
  const body = (req.body || {}) as { input?: unknown; lat?: unknown; lng?: unknown };
  const input = String(body.input || '').trim().slice(0, 120);

  if (!key) return res.status(200).json({ suggestions: [], error: NO_KEY_MESSAGE });
  if (input.length < 3) return res.status(200).json({ suggestions: [] });

  const payload: Record<string, unknown> = { input, includedRegionCodes: ['us', 'ca'] };
  const lat = Number(body.lat);
  const lng = Number(body.lng);
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    payload.locationBias = { circle: { center: { latitude: lat, longitude: lng }, radius: 50000 } };
  }

  try {
    const r = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(6000),
    });
    if (!r.ok) {
      console.warn('[PlacesAutocomplete] upstream', r.status, (await r.text()).slice(0, 200));
      return res.status(200).json({ suggestions: [], error: NO_KEY_MESSAGE });
    }
    const d: any = await r.json();
    const suggestions = ((d.suggestions || []) as any[])
      .map((sg) => sg.placePrediction)
      .filter(Boolean)
      .map((pp: any) => ({
        placeId: String(pp.placeId || ''),
        main: String(pp.structuredFormat?.mainText?.text || pp.text?.text || ''),
        secondary: String(pp.structuredFormat?.secondaryText?.text || ''),
      }))
      .filter((sg: any) => sg.placeId && sg.main)
      .slice(0, 6);
    return res.status(200).json({ suggestions });
  } catch (err: any) {
    console.warn('[PlacesAutocomplete] failed:', err?.message || err);
    return res.status(200).json({ suggestions: [], error: NO_KEY_MESSAGE });
  }
}
