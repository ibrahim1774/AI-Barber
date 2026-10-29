// Pure, browser-safe normalizers for what a booking-page scrape returns: service prices, service durations and
// opening hours. Used by every scraper (finalize in lib/scrapers/util.ts) AND by buildSiteFromScrape (so an older
// scrape response, or one from a provider whose text was never cleaned, still lands in the shapes the editor
// uses). Idempotent: running a normalized value through again returns it unchanged. No imports (vendored to the app).

const CURRENCY_SYMBOL: Record<string, string> = { USD: '$', CAD: 'C$', AUD: 'A$', EUR: '€', GBP: '£', MXN: '$' };

/** "$" for USD (and unknown), "£" for GBP, ... */
export function currencySymbol(code: unknown): string {
  return CURRENCY_SYMBOL[String(code ?? '').trim().toUpperCase()] ?? '$';
}

const money = (n: number): string => {
  const s = n.toFixed(2);
  return s.endsWith('.00') ? s.slice(0, -3) : s;
};

/**
 * A scraped price as the site shows it, or '' when there is none to show (the app's example-price fallback then
 * applies). Bare numbers become "$30" / "$30.50"; the provider's own text is kept when it carries a number:
 * "$30+", "from $30", "$25 - $40", "£20". "$$30" and "$30.00" are cleaned. "Varies" / "N/A" / 0 are no price.
 */
export function normalizePrice(raw: unknown, symbol = '$'): string {
  if (typeof raw === 'number') return Number.isFinite(raw) && raw > 0 ? `${symbol}${money(raw)}` : '';
  if (typeof raw !== 'string') return '';
  let s = raw.replace(/\s+/g, ' ').trim();
  if (!s) return '';
  if (/^free$/i.test(s)) return 'Free';
  if (!/\d/.test(s)) return '';
  // A struck-through old price printed right before the current one ("$35$30"): the current (last) one counts.
  const stacked = s.match(/^(?:[$£€]\d[\d.,]*){2,}$/);
  if (stacked) s = s.slice(s.search(/[$£€](?=\d[\d.,]*$)/));
  s = s.replace(/(\D)\1(?=\d)/g, '$1'); // "$$30" -> "$30"
  const bare = s.match(/^(\d+(?:\.\d+)?)(\+?)$/);
  if (bare) {
    const n = Number(bare[1]);
    return n > 0 ? `${symbol}${money(n)}${bare[2]}` : '';
  }
  const bareRange = s.match(/^(\d+(?:\.\d+)?)\s*[-–—]\s*(\d+(?:\.\d+)?)(\+?)$/);
  if (bareRange) return `${symbol}${money(Number(bareRange[1]))} - ${symbol}${money(Number(bareRange[2]))}${bareRange[3]}`;
  return s.replace(/(\d)\.00\b/g, '$1');
}

/** "$25 - $40" from an offer's low and high price (either may be missing), '' when neither is usable. */
export function priceFromBounds(low: unknown, high: unknown, symbol = '$'): string {
  const a = normalizePrice(low, symbol);
  const b = normalizePrice(high, symbol);
  if (a && b && a !== b) return `${a} - ${b}`;
  return a || b;
}

/**
 * A scraped duration as "30 min" / "1 hr" / "1 hr 15 min". Reads "30min", "30 minutes", "1h 15m", "PT1H15M", 45 and
 * "45". Text it cannot read is kept as the provider wrote it; empty stays empty.
 */
export function normalizeDuration(raw: unknown): string {
  if (typeof raw === 'number') return Number.isFinite(raw) && raw > 0 ? fmtMinutes(Math.round(raw)) : '';
  if (typeof raw !== 'string') return '';
  const s = raw.replace(/\s+/g, ' ').trim();
  if (!s) return '';
  const iso = s.match(/^PT(?:(\d+)H)?(?:(\d+)M)?$/i);
  if (iso && (iso[1] || iso[2])) return fmtMinutes(Number(iso[1] || 0) * 60 + Number(iso[2] || 0));
  if (/^\d+$/.test(s)) return fmtMinutes(Number(s));
  const range = s.match(/^(\d+)\s*[-–]\s*(\d+)\s*(?:m|min|mins|minutes?)$/i);
  if (range) return `${range[1]}-${range[2]} min`;
  const m = s.match(/^(?:(\d+)\s*(?:h|hr|hrs|hours?))?\s*(?:(\d+)\s*(?:m|min|mins|minutes?))?$/i);
  if (m && (m[1] || m[2])) return fmtMinutes(Number(m[1] || 0) * 60 + Number(m[2] || 0));
  return s;
}

function fmtMinutes(total: number): string {
  if (!(total > 0)) return '';
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h && m) return `${h} hr ${m} min`;
  return h ? `${h} hr` : `${m} min`;
}

/** "9", "9am", "9:30 PM", "17:00", "noon" -> "HH:MM" (24-hour); anything else comes back as it was. */
export function toHHMM(raw: unknown): string {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  if (/^noon$/i.test(s)) return '12:00';
  if (/^midnight$/i.test(s)) return '00:00';
  const m = s.match(/^(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*([ap])\.?m?\.?$/i) ?? s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?()$/);
  if (!m) return s;
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  const ap = (m[3] || '').toLowerCase();
  if (min > 59) return s;
  if (ap) {
    if (h < 1 || h > 12) return s;
    h = (h % 12) + (ap === 'p' ? 12 : 0);
  } else if (h > 23) return s;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

export interface HoursRowLike { day: string; open: string; close: string; closed?: boolean }

/**
 * Scraped hours in the shape the Hours editor and the bookings wizard read: 24-hour "HH:MM" times, one row per
 * day. A day with no times is closed. Returns [] (so the default week applies) when there are no rows, nothing
 * readable, or every day is closed. Times that are not clock times ("By appointment") are kept as they are.
 */
export function normalizeHours(rows: unknown): HoursRowLike[] {
  if (!Array.isArray(rows)) return [];
  const out: HoursRowLike[] = [];
  for (const r of rows) {
    const day = typeof r?.day === 'string' ? r.day.trim() : '';
    if (!day) continue;
    const open = toHHMM(r.open);
    const close = toHHMM(r.close);
    if (r.closed || (!open && !close)) out.push({ day, open: open || '', close: close || '', closed: true });
    else out.push({ day, open, close });
  }
  return out.some((r) => !r.closed) ? out : [];
}
