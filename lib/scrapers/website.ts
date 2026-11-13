// Generic "any shop website" importer (api/import-scrape with source 'website'). No LLM: it reads what the page says
// about itself, in this order, and never invents a value:
//   1. schema.org JSON-LD / OpenGraph / tel: / <address> (structured.ts, the same reader Squire / GlossGenius use);
//   2. text heuristics on the visible page: "$NN" price lines next to service names, day + time hours tables, phone
//      numbers, US street addresses, mailto:, social profile links, <img> photos and the logo / favicon;
//   3. if the static HTML has no shop data (a JS-rendered shell), ONE Apify web-scraper run (a real browser) renders the
//      page and the same readers run on the rendered HTML. Only with APIFY_TOKEN; never in tests;
//   4. enrichFromGoogle (index.ts) fills hours / phone / address the page lacked. Photos are never taken from Google.
// Photos follow the booking imports: hotlinked https URLs (cleanPhotoUrls + dedupe + cap in finalize), nothing is
// downloaded or re-hosted here. Image URLs get the same host rules as the page (https, public-looking host, no IP
// literal / odd port). Returns the same ScrapedShop payload the booking adapters return.
import { normalizeDuration, normalizeHours, normalizePrice, toHHMM } from '../scrapeNormalize.js';
import { decodeEntities, finalize, formatUsPhone, galleryPageFunction, metaContent, runApifyWebScraper, cleanPhotoUrls } from './util.js';
import { shopFromStructuredHtml } from './structured.js';
import { fetchPublicHtml, isPublicImageUrl, type SafeFetchDeps } from './safeFetch.js';
import type { ScrapedShop, ScrapeOptions } from './types.js';
import { ScrapeError } from './types.js';

const safeDecode = (s: string): string => { try { return decodeURIComponent(s); } catch { return s; } };
const clean = (s: unknown): string => decodeEntities(String(s ?? '')).replace(/\s+/g, ' ').trim();

// ── HTML -> visible text lines ─────────────────────────────────────────────────────────────────────────────────

function decodeAll(s: string): string {
  return decodeEntities(s)
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Math.min(Number(n), 0x10ffff)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(Math.min(parseInt(n, 16), 0x10ffff)))
    .replace(/&ndash;/g, '–').replace(/&mdash;/g, '—').replace(/&middot;/g, '·').replace(/&hellip;/g, '…');
}

export function htmlToLines(html: string): string[] {
  const body = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|template|head)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article|ul|ol|table|dt|dd|header|footer|address|option|label)>/gi, '\n')
    .replace(/<\/(td|th)>/gi, '  ')
    .replace(/<[^>]*>/g, ' ');
  return decodeAll(body)
    .split('\n')
    .map((l) => l.replace(/[\s ]+/g, ' ').trim())
    .filter(Boolean);
}

// ── Services: "$NN" price lines ────────────────────────────────────────────────────────────────────────────────

const PRICE = String.raw`\$\s?\d{1,4}(?:\.\d{2})?\+?`;
const PRICE_ONLY = new RegExp(String.raw`^(?:from\s+|starting at\s+)?(${PRICE})(?:\s*(?:-|–|—|to)\s*(${PRICE}))?\s*$`, 'i');
const DURATION = /\(?\b(\d{1,3})\s*(?:min|mins|minutes)\b\)?|\b(\d)\s*(?:hr|hrs|hour|hours)\b(?:\s*(\d{1,2})\s*(?:min|mins))?/i;
const NAME_JUNK = /^(total|subtotal|tax|tip|deposit|price|prices|cost|menu|services?|book(ing)?|call|from|starting|cash|card|payment)s?:?$/i;
const SENTENCE = /[.!?]\s+[A-Z]|\b(we|our|your|you|are|is|the)\b.*\b(and|with|for)\b.*\b(and|with|for)\b/;

function tidyName(raw: string): { title: string; duration?: string } {
  let t = raw.replace(/[\s.…·•|:–—-]+$/g, '').replace(/^[\s.…·•|:–—-]+/g, '');
  let duration: string | undefined;
  const d = t.match(DURATION);
  if (d) {
    duration = normalizeDuration(d[1] ? `${d[1]} min` : `${d[2]} hr${d[3] ? ` ${d[3]} min` : ''}`) || undefined;
    t = t.replace(DURATION, ' ');
  }
  t = t.replace(/[()[\]]/g, ' ').replace(/\s+/g, ' ').replace(/[\s.…·•|:–—-]+$/g, '').trim();
  return { title: t, duration };
}

const cleanSvc = (s: Svc): Svc => (s.description ? { ...s, description: removeBooksy(s.description) || undefined } : s);

function goodName(t: string): boolean {
  return t.length >= 3 && t.length <= 70 && /[A-Za-z]{3}/.test(t) && !NAME_JUNK.test(t) && !SENTENCE.test(t) && t.split(' ').length <= 9 && !/@|https?:/i.test(t);
}

function priceText(a: string, b?: string): string {
  const pa = normalizePrice(a.replace(/\s/g, ''));
  const pb = b ? normalizePrice(b.replace(/\s/g, '')) : '';
  return pb && pb !== pa ? `${pa.replace(/\+$/, '')} - ${pb}` : pa;
}

const BUTTON_WORDS = String.raw`(?:book(?:\s+(?:now|online|appointment|this|today))?|select|reserve|choose|schedule|add(?:\s+to\s+cart)?|buy(?:\s+now)?)`;
const BUTTON_TAIL = new RegExp(String.raw`\s*[-–—|·•]?\s*${BUTTON_WORDS}\s*[→>»›]*\s*$`, 'i');
const BUTTON_LINE = new RegExp(String.raw`^${BUTTON_WORDS}\s*[→>»›]*$`, 'i');
const PROMO_WORDS = /\b(deposits?|gift|gifts|save|saves|saving|off|tips?|promo|promotion|discount|coupon|voucher|required|credits?|membership|refund|per\s+person)\b/i;
const DURATION_LINE = /^\(?\s*(?:\d{1,3}\s*(?:min|mins|minutes)|\d\s*(?:hr|hrs|hour|hours)(?:\s*\d{1,2}\s*(?:min|mins))?)\s*\)?$/i;

const LEADING_DURATION = /^\(?\s*(\d{1,3}\s*(?:min|mins|minutes)|\d\s*(?:hr|hrs|hour|hours)(?:\s*\d{1,2}\s*(?:min|mins))?)\b/i;

/** A short, sentence-free line that can head a service card: not a duration, a button or a price. */
function headingLike(l: string): boolean {
  if (l.includes('$') || l.length > 45 || DURATION_LINE.test(l) || BUTTON_LINE.test(l)) return false;
  if (/[.!?,;:]/.test(l.replace(/\(.*?\)/g, ''))) return false;
  if (PROMO_WORDS.test(l)) return false;
  const n = tidyName(l);
  return n.title.split(' ').length <= 6 && goodName(n.title);
}

export function servicesFromLines(lines: string[]): NonNullable<ScrapedShop['services']> {
  const out: NonNullable<ScrapedShop['services']> = [];
  const seen = new Set<string>();
  const push = (title: string, price: string, duration?: string) => {
    const key = title.toLowerCase();
    if (!goodName(title) || PROMO_WORDS.test(title) || !price || seen.has(key)) return;
    seen.add(key);
    out.push({ title, price, duration });
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(BUTTON_TAIL, '').trim();
    if (!line.includes('$') || PROMO_WORDS.test(line)) continue;
    // A line that is only a price ("$25", "$25 Book") belongs to the heading a few lines above (a card).
    const only = line.match(PRICE_ONLY);
    if (only) {
      let duration: string | undefined;
      for (let j = i - 1; j >= Math.max(0, i - 3); j--) {
        const prev = lines[j];
        if (prev.includes('$') || BUTTON_LINE.test(prev)) break;
        if (DURATION_LINE.test(prev)) {
          duration = duration || normalizeDuration(prev.replace(/[()]/g, '')) || undefined;
          continue;
        }
        // "30 min A timeless cut…": an inline duration chip that ran into the description line
        const lead = prev.match(LEADING_DURATION);
        if (lead) {
          duration = duration || normalizeDuration(lead[1]) || undefined;
          continue;
        }
        if (headingLike(prev)) {
          const n = tidyName(prev);
          push(n.title, priceText(only[1], only[2]), n.duration || duration);
          break;
        }
      }
      continue;
    }
    const prices = line.match(new RegExp(PRICE, 'g')) || [];
    if (!prices.length || prices.length > 2) continue;
    const first = line.indexOf(prices[0]);
    const last = prices[prices.length - 1];
    const after = tidyName(line.slice(line.indexOf(last) + last.length)).title;
    // "Haircut ..... $30", "Haircut - $30 - $40", "Haircut (30 min) $30"
    let before = line.slice(0, first);
    if (!/[A-Za-z]/.test(before)) {
      // "$30 Haircut" (price first): the name is what follows the last price.
      before = line.slice(line.indexOf(last) + last.length);
    } else if (/[A-Za-z]{3}/.test(after) && after.length > 12) {
      continue; // prose after the price ("Haircut $30 includes a shampoo..."): not a menu row
    }
    const n = tidyName(before.replace(/\b(from|starting at)\s*$/i, ''));
    // The name must be most of the line, not a few words in a sentence.
    if (n.title.length < line.replace(new RegExp(PRICE, 'g'), '').replace(DURATION, '').replace(/[\s.…·•|:–—()-]+/g, ' ').trim().length * 0.6) continue;
    const range = prices.length === 2 ? priceText(prices[0], prices[1]) : priceText(prices[0]);
    push(n.title, range, n.duration);
  }
  return out;
}

// ── Service cards (static multi-page sites): Name / description / duration / "$35.00 · 30min" ─────────────────────

/** Like htmlToLines, but also breaks at inline boxes (a, span, small, s, strong, b, em), so a price-list row built from
 *  <a><span>Name<small>desc · 30min</small></span><span><s>$42.00</s>$35.70</span></a> becomes separate lines. */
export function htmlToCardLines(html: string): string[] {
  return htmlToLines(html.replace(/<\/?(?:a|span|small|s|strike|del|strong|b|em|i)\b[^>]*>/gi, '\n'));
}

const DUR_SRC = String.raw`\d{1,3}\s*(?:min|mins|minutes)|\d\s*(?:h|hr|hrs|hour|hours)(?:\s*\d{1,2}\s*(?:min|mins|m))?`;
const DUR_ONLY = new RegExp(String.raw`^\(?\s*(${DUR_SRC})\s*\)?$`, 'i');
const DUR_LEAD_BOOKSY = new RegExp(String.raw`^(?:(.*?)\s+)?(${DUR_SRC})\s+on\s+booksy\.?$`, 'i');
const DUR_TRAIL = new RegExp(String.raw`^(.*?)\s*[·•|]\s*(${DUR_SRC})$`, 'i');
const CARD_PRICE = new RegExp(String.raw`^(\$\s?\d{1,4}(?:\.\d{2})?)(\+?)\s*(?:[·•|]\s*(${DUR_SRC}))?$`, 'i');
const ROMAN_MARKER = /^[—–-]\s*[IVXLCDM]+$/;
const LINK_TEXT = /^(?:learn more|read more|view|details|see more|more info|book(?:\s+\w+){0,3}|select|reserve|choose|schedule)\b.{0,12}$|[→›»>]$/i;

export function normName(s: string): string {
  return s.toLowerCase().replace(/[’‘`]/g, "'").replace(/[^a-z0-9]+/g, ' ').trim();
}

type Svc = NonNullable<ScrapedShop['services']>[number];
const info = (s: Svc): number => (s.price ? 1 : 0) + (s.duration ? 1 : 0) + (s.description ? 1 : 0);

/** De-duplicate by normalised name, keeping the entry with the most info (first position wins ties). */
export function mergeServices(...lists: Svc[][]): Svc[] {
  const byKey = new Map<string, Svc>();
  for (const l of lists) for (const s of l) {
    const k = normName(s.title);
    if (!k) continue;
    const cur = byKey.get(k);
    if (!cur) byKey.set(k, s);
    else if (info(s) > info(cur)) byKey.set(k, { ...s, title: cur.title });
    else if (info(s) === info(cur) && !cur.description && s.description) byKey.set(k, { ...cur, description: s.description });
  }
  return [...byKey.values()];
}

function isCardName(l: string): boolean {
  if (l.length < 3 || l.length > 80 || l.includes('$') || !/[A-Za-z]{3}/.test(l)) return false;
  if (DUR_ONLY.test(l) || ROMAN_MARKER.test(l) || LINK_TEXT.test(l) || NAME_JUNK.test(l)) return false;
  if (/[.!?]$/.test(l) || /\bon booksy\b/i.test(l) || DUR_TRAIL.test(l) || /@|https?:/i.test(l)) return false;
  return true;
}

/** Cards whose price line is a lone "$35.00", "$25.00+" or "$35.00 · 30min". A second price line right after the
 *  first (promo price) is ignored, so the regular price is the one kept. */
export function serviceCardsFromLines(lines: string[]): Svc[] {
  const out: Svc[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(CARD_PRICE);
    if (!m || (i > 0 && CARD_PRICE.test(lines[i - 1]))) continue;
    let duration = m[3] ? normalizeDuration(m[3]) : '';
    const desc: string[] = [];
    let name = '';
    for (let j = i - 1; j >= Math.max(0, i - 4); j--) {
      const l = lines[j];
      if (l.includes('$')) break;
      if (ROMAN_MARKER.test(l) || LINK_TEXT.test(l)) break;
      let d: RegExpMatchArray | null;
      if ((d = l.match(DUR_ONLY))) { duration = duration || normalizeDuration(d[1]); continue; }
      if ((d = l.match(DUR_LEAD_BOOKSY))) { duration = duration || normalizeDuration(d[2]); if (d[1]) desc.unshift(d[1]); continue; }
      if ((d = l.match(DUR_TRAIL))) { duration = duration || normalizeDuration(d[2]); if (d[1]) desc.unshift(d[1]); continue; }
      if (/[.!?]$/.test(l)) { desc.unshift(l); continue; }
      if (isCardName(l)) { name = l; break; }
      break;
    }
    if (!name) continue;
    const description = removeBooksy(desc.join(' ')) || undefined;
    out.push({ title: name, price: normalizePrice(m[1].replace(/\s/g, '') + m[2]), duration: duration || undefined, description });
  }
  return mergeServices(out);
}

/** Drop references to Booksy from imported text (the shop's Booksy account may be gone): booking-call sentences go,
 *  "83 Booksy reviews" -> "83 reviews", "on Booksy" is cut out. */
export function removeBooksy(text: string): string {
  if (!/booksy/i.test(text)) return text.replace(/\s+/g, ' ').trim();
  let t = text.replace(/\s*[—–-]\s*Booksy[’']?s?\s+promo pricing online\b/gi, '').replace(/\bBooksy[’']?s?\s+promo pricing online\b/gi, '');
  const sentences = t.split(/(?<=[.!?])\s+/).filter((sent) => !(/booksy/i.test(sent) && /\b(book|books|booking|reserve|schedule)\b/i.test(sent)));
  t = sentences.join(' ')
    .replace(/\bBooksy[’']?s?\s+(?=reviews?\b)/gi, '')
    .replace(/\s+(?:on|via|through|from|in)\s+Booksy[’']?s?\b/gi, '');
  return t.split(/(?<=[.!?])\s+/).filter((sent) => !/booksy/i.test(sent)).join(' ').replace(/\s+([.,!?])/g, '$1').replace(/\s+/g, ' ').trim();
}

/** The first real paragraph(s) of an about page, at most `max` characters, Booksy references removed. */
export function aboutTextFromHtml(html: string, max = 400): string {
  const body = html
    .replace(/<(script|style|noscript|template|head|header|nav|footer|aside|svg)\b[\s\S]*?<\/\1>/gi, ' ');
  const paras: string[] = [];
  for (const m of body.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) {
    const t = removeBooksy(clean(m[1].replace(/<[^>]*>/g, ' ')));
    if (t.split(' ').length < 8 || t.length < 50) continue;
    if (/^(book|reserve|call|come|ready|see|find|follow)\b/i.test(t) && t.length < 110) continue;
    if (/^["“”]/.test(t) || /^[—–-]/.test(t)) continue; // pull quotes
    paras.push(t);
  }
  if (!paras.length) return '';
  let out = paras[0];
  if (out.length > max) {
    const cut = out.slice(0, max);
    const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '), /[.!?]$/.test(cut) ? cut.length - 1 : -1);
    return end > 80 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, '') + '…';
  }
  for (const p of paras.slice(1)) {
    if ((out + ' ' + p).length > max) break;
    out += ' ' + p;
  }
  return out;
}

// ── Hours: "Monday 9:00 AM - 6:00 PM", "Mon-Fri: 9am-6pm", "Sunday Closed" ─────────────────────────────────────

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const DAY_WORD = String.raw`(?:mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday|rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)`;
const DAY_SPEC = new RegExp(String.raw`^(${DAY_WORD}(?:\s*(?:-|–|—|to|through|thru|,|&|and)\s*${DAY_WORD})*)\b\.?\s*[:\-–—]?\s*(.*)$`, 'i');
const TIME = String.raw`(?:\d{1,2}(?::\d{2})?\s*(?:[ap]\.?m\.?)?|noon|midnight)`;
const RANGE = new RegExp(String.raw`^(${TIME})\s*(?:-|–|—|to|until)\s*(${TIME})\b`, 'i');

const dayIndex = (w: string): number => DAY_NAMES.findIndex((d) => d.toLowerCase().startsWith(w.toLowerCase().slice(0, 3)));

function daysOf(spec: string): number[] {
  const parts = spec.split(/\s*(,|&|\band\b)\s*/i).filter((p) => p && !/^(,|&|and)$/i.test(p));
  const out: number[] = [];
  for (const part of parts) {
    const ends = part.split(/\s*(?:-|–|—|\bto\b|\bthrough\b|\bthru\b)\s*/i).filter(Boolean);
    const a = dayIndex(ends[0]);
    const b = ends.length > 1 ? dayIndex(ends[ends.length - 1]) : a;
    if (a < 0 || b < 0) continue;
    // Mon-Sun order; a wrap ("Fri-Mon") continues through the week end.
    for (let d = a, n = 0; n < 7; n++, d = (d + 1) % 7) {
      out.push(d);
      if (d === b) break;
    }
  }
  return out;
}

function clock(open: string, close: string): { open: string; close: string } | null {
  const hasAp = (t: string) => /[ap]\.?m?\.?$/i.test(t.trim());
  let o = open.trim();
  const c = close.trim();
  const cm = c.match(/([ap])\.?m?\.?$/i);
  if (!hasAp(o) && cm && /^\d{1,2}(:\d{2})?$/.test(o)) {
    // "9 - 5pm": the opening time takes the closing one's period unless that would open after closing.
    const same = toHHMM(`${o} ${cm[1]}m`);
    const flip = toHHMM(`${o} ${cm[1].toLowerCase() === 'p' ? 'am' : 'pm'}`);
    const closeH = toHHMM(c);
    o = same < closeH ? `${o} ${cm[1]}m` : flip < closeH ? `${o} ${cm[1].toLowerCase() === 'p' ? 'am' : 'pm'}` : o;
  }
  const oh = toHHMM(o);
  const ch = toHHMM(c);
  const ok = /^\d{2}:\d{2}$/;
  return ok.test(oh) && ok.test(ch) && oh !== ch ? { open: oh, close: ch } : null;
}

export function hoursFromLines(lines: string[]): ScrapedShop['hours'] {
  const byDay = new Map<number, { open: string; close: string; closed?: boolean }>();
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(DAY_SPEC);
    if (!m) continue;
    let rest = m[2].trim();
    if (!rest && lines[i + 1] && !DAY_SPEC.test(lines[i + 1])) rest = lines[i + 1].trim();
    if (rest.length > 60) continue;
    const days = daysOf(m[1]);
    if (!days.length) continue;
    let val: { open: string; close: string; closed?: boolean } | null = null;
    if (/^(closed|off|day off)\b/i.test(rest)) val = { open: '', close: '', closed: true };
    else {
      const r = rest.match(RANGE);
      const t = r ? clock(r[1], r[2]) : null;
      if (t) val = t;
    }
    if (!val) continue;
    for (const d of days) if (!byDay.has(d)) byDay.set(d, val);
  }
  if (![...byDay.values()].some((v) => !v.closed)) return [];
  return normalizeHours(DAY_NAMES.map((day, i) => ({ day, ...(byDay.get(i) || { open: '', close: '', closed: true }) })));
}

// ── Contact, address, socials, images ──────────────────────────────────────────────────────────────────────────

const PHONE = /(?:\+?1[\s.-]?)?\(?\b([2-9]\d{2})\)?[\s.-]?(\d{3})[\s.-]?(\d{4})\b/;

export function phoneFrom(html: string, lines: string[]): string {
  const tel = html.match(/href=["']tel:([^"']+)["']/i);
  if (tel) {
    const f = formatUsPhone(safeDecode(tel[1]).replace(/[^\d+]/g, ''));
    if (f) return f;
  }
  for (const l of lines) {
    if (l.length > 90) continue;
    const m = l.match(PHONE);
    if (m) return `(${m[1]}) ${m[2]}-${m[3]}`;
  }
  return '';
}

export function emailFrom(html: string): string {
  const m = html.match(/href=["']mailto:([^"'?]+)/i);
  const e = m ? safeDecode(m[1]).trim() : '';
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : '';
}

const US_ADDRESS = /\b(\d{1,6}\s+[A-Za-z0-9.'# -]{2,40}?),?\s+([A-Za-z.' -]{2,30}),?\s+([A-Z]{2})\.?,?\s+(\d{5})(?:-\d{4})?\b/;

export function addressFromLines(lines: string[]): { address: string; area: string } | null {
  const joined = [...lines, ...lines.slice(0, -1).map((l, i) => `${l}, ${lines[i + 1]}`)];
  for (const l of joined) {
    if (l.length > 140) continue;
    const m = l.match(US_ADDRESS);
    if (m) {
      const street = m[1].trim();
      const city = m[2].trim();
      return { address: `${street}, ${city}, ${m[3]}, ${m[4]}`, area: `${city}, ${m[3]}` };
    }
  }
  return null;
}

const SOCIAL_HOSTS: [keyof NonNullable<ScrapedShop['socials']>, RegExp][] = [
  ['instagram', /^(?:www\.)?instagram\.com$/i],
  ['facebook', /^(?:www\.|m\.)?facebook\.com$/i],
  ['tiktok', /^(?:www\.)?tiktok\.com$/i],
  ['x', /^(?:www\.)?(?:x|twitter)\.com$/i],
  ['youtube', /^(?:www\.)?youtube\.com$/i],
];
const SOCIAL_SKIP = /^\/(?:sharer|share|intent|plugins|tr|dialog|p|reel|reels|explore|watch|embed|hashtag|login|policy|help)\b/i;

export function socialsFrom(html: string): NonNullable<ScrapedShop['socials']> {
  const out: NonNullable<ScrapedShop['socials']> = {};
  for (const m of html.matchAll(/<a\b[^>]*\bhref=["']([^"']+)["']/gi)) {
    let u: URL;
    try { u = new URL(decodeAll(m[1])); } catch { continue; }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') continue;
    const hit = SOCIAL_HOSTS.find(([, re]) => re.test(u.hostname));
    if (!hit || out[hit[0]] || u.pathname.length < 2 || SOCIAL_SKIP.test(u.pathname)) continue;
    out[hit[0]] = `https://${u.hostname.replace(/^m\./, '')}${u.pathname.replace(/\/$/, '')}`;
  }
  return out;
}

const JUNK_IMG = /logo|icon|avatar|sprite|placeholder|favicon|emoji|badge|flag|pixel|spinner|blank|loader|arrow|star|payment|visa|mastercard|paypal|stripe|\.svg|\.gif|1x1|tracking/i;

const JUNK_HINT = /\b(?:[\w-]*icon[\w-]*|[\w-]*logo[\w-]*|sprite|avatar|favicon|pixel|tracking)\b/i;

/** `/_next/image?url=%2Fimg%2Fa.jpg&w=640`: the real image when it is same-site https; otherwise the URL unchanged. */
function unwrapNextImage(u: string, base: string): string {
  try {
    const p = new URL(u);
    if (p.pathname !== '/_next/image') return u;
    const inner = p.searchParams.get('url');
    if (!inner) return u;
    const real = new URL(inner, base);
    return real.protocol === 'https:' && real.hostname === new URL(base).hostname ? real.toString() : u;
  } catch { return u; }
}

function resolveUrl(raw: string, base: string): string {
  if (!raw || !raw.trim()) return '';
  try { return new URL(decodeAll(raw.trim()), base).toString(); } catch { return ''; }
}

export function imagesFrom(html: string, base: string): string[] {
  const body = html.replace(/<(script|style|noscript|template|head)\b[\s\S]*?<\/\1>/gi, ' ');
  const stripped = body.replace(/<(header|nav|footer|aside)\b[\s\S]*?<\/\1>/gi, ' ');
  const urls: string[] = [];
  const consider = (raw: string) => {
    const u = unwrapNextImage(resolveUrl(raw, base), base);
    if (u && !JUNK_IMG.test(u.replace(/^https?:\/\/[^/]+/, '')) && isPublicImageUrl(u)) urls.push(u);
  };
  for (const m of stripped.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    const w = Number((tag.match(/\bwidth=["']?(\d+)/i) || [])[1] || 0);
    const h = Number((tag.match(/\bheight=["']?(\d+)/i) || [])[1] || 0);
    if ((w && w < 200) || (h && h < 200)) continue;
    // class / alt that says icon, logo, sprite, avatar, favicon or tracking pixel
    const hint = [(tag.match(/\bclass=["']([^"']*)["']/i) || [])[1], (tag.match(/\balt=["']([^"']*)["']/i) || [])[1]].join(' ');
    if (JUNK_HINT.test(decodeAll(hint))) continue;
    const srcset = (tag.match(/\b(?:data-)?srcset=["']([^"']+)["']/i) || [])[1];
    const src = (tag.match(/\bdata-(?:src|lazy-src|original)=["']([^"']+)["']/i) || tag.match(/\bsrc=["']([^"']+)["']/i) || [])[1];
    if (srcset) {
      // The widest candidate.
      const best = srcset.split(',').map((c) => c.trim().split(/\s+/)).sort((a, b) => parseInt(b[1] || '0') - parseInt(a[1] || '0'))[0];
      if (best?.[0]) { consider(best[0]); continue; }
    }
    if (src) consider(src);
  }
  // style="background-image:url(&quot;…&quot;)": decode the entities first so the quotes are real quotes.
  for (const m of decodeAll(stripped).matchAll(/background(?:-image)?\s*:\s*url\(\s*(["']?)([^)"']+)\1\s*\)/gi)) consider(m[2]);
  return urls;
}

function logoFrom(html: string, base: string, ldLogo: unknown): string {
  const cands: string[] = [];
  const ld = typeof ldLogo === 'string' ? ldLogo : (ldLogo as any)?.url;
  if (ld) cands.push(String(ld));
  const hdr = (html.match(/<(?:header|nav)\b[\s\S]*?<\/(?:header|nav)>/i) || [''])[0];
  for (const m of hdr.matchAll(/<img\b[^>]*>/gi)) if (/logo/i.test(m[0])) {
    const s = (m[0].match(/\bsrc=["']([^"']+)["']/i) || [])[1];
    if (s) cands.push(s);
  }
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    if (!/rel=["'][^"']*(apple-touch-icon|icon)[^"']*["']/i.test(m[0])) continue;
    const h = (m[0].match(/\bhref=["']([^"']+)["']/i) || [])[1];
    if (h) cands.push(h);
  }
  for (const c of cands) {
    const u = resolveUrl(c, base);
    if (u && isPublicImageUrl(u)) return u;
  }
  return '';
}

const GENERIC_SEG = /^(home|welcome|index|homepage|main)$/i;

/** "Sharp Edge Barbers | Best Fades in Brooklyn": keep the first segment unless it is generic ("Home", "Welcome"). */
export function stripSeoTail(raw: string): string {
  const segs = clean(raw).split(/\s+[-–—]\s+|\s*[|·]\s*/).map((x) => x.trim()).filter(Boolean);
  return segs.find((x) => !GENERIC_SEG.test(x)) || '';
}

function nameFrom(html: string, lines: string[]): string {
  const site = clean(metaContent(html, 'og:site_name'));
  if (site) return site;
  const title = clean((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]);
  const seg = title.split(/\s*[|–—•·]\s*|\s+-\s+/).map((s) => s.trim()).filter(Boolean);
  const generic = /^(home|welcome|index|untitled|react app|vite app|vite \+ react|my app|loading\.*|just a moment\.*|403 forbidden|404.*|error.*|page not found)$/i;
  const real = seg.filter((s) => !generic.test(s) && !/^(book|booking|services|about|contact|prices|menu)\b/i.test(s));
  if (real.length) return real[0].slice(0, 80);
  const h1 = (html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i) || [])[1];
  const t = h1 ? clean(h1.replace(/<[^>]*>/g, ' ')) : '';
  return t && t.length < 80 && !generic.test(t) ? t : (lines.length ? '' : '');
}

// ── Parse one HTML page ────────────────────────────────────────────────────────────────────────────────────────

export function hasShopData(shop: ScrapedShop | null): boolean {
  if (!shop || !shop.shopName) return false;
  return !!(shop.services.length || shop.phone || shop.address || (shop.hours || []).some((h) => !h.closed));
}

export function parseWebsiteHtml(html: string, pageUrl: string): ScrapedShop | null {
  const lines = htmlToLines(html);
  const structured = shopFromStructuredHtml(html);
  const ldLogo = (() => { const m = html.match(/"logo"\s*:\s*("(?:[^"\\]|\\.)*"|\{[^}]*\})/); try { return m ? JSON.parse(m[1]) : undefined; } catch { return undefined; } })();

  // structured.ts falls back to the raw og:title; for websites the SEO tail (" | Best fades in…") is cut off.
  const sn = structured?.shopName;
  const ogRaw = clean(metaContent(html, 'og:title'));
  const shopName = (sn && ogRaw.startsWith(sn) ? stripSeoTail(sn) || sn : sn) || nameFrom(html, lines);
  if (!shopName) return null;

  const addr = structured?.address ? null : addressFromLines(lines);
  const hours = (structured?.hours || []).some((h) => !h.closed) ? structured!.hours! : hoursFromLines(lines);
  const textServices = mergeServices(servicesFromLines(lines).map(cleanSvc), serviceCardsFromLines(htmlToCardLines(html)));
  const services = structured?.services?.length ? structured.services : textServices;
  const imgs = [...(structured?.photos || []), ...imagesFrom(html, pageUrl)].map((p) => resolveUrl(p, pageUrl)).filter(isPublicImageUrl);
  const og = resolveUrl(metaContent(html, 'og:image'), pageUrl);

  const shop: ScrapedShop = {
    shopName,
    area: structured?.area || addr?.area || '',
    address: structured?.address || addr?.address || '',
    phone: structured?.phone || phoneFrom(html, lines),
    description: removeBooksy(structured?.description || clean(metaContent(html, 'description')) || clean(metaContent(html, 'og:description'))),
    hours,
    aggregateRating: structured?.aggregateRating,
    staff: structured?.staff || [],
    services,
    photos: [...(og && isPublicImageUrl(og) ? [og] : []), ...imgs],
    reviews: structured?.reviews || [],
  };
  const email = emailFrom(html);
  const socials = socialsFrom(html);
  const logo = logoFrom(html, pageUrl, ldLogo);
  const out = finalize(shop, { services: 24, photos: 20 });
  if (email) out.email = email;
  if (logo) out.logo = logo;
  if (Object.keys(socials).length) out.socials = socials;
  return out;
}

// ── Entry point ────────────────────────────────────────────────────────────────────────────────────────────────

// Total server time stays under 60 s: 8 s page fetch + (static sites: sub-pages in parallel, 10 s in all; JS shells: at most
// this wait for the one Apify run, no sub-pages) + one Places lookup.
export const APIFY_WAIT_SEC = 45;

// ── Sub-pages: services / gallery / about of a static multi-page site ──────────────────────────────────────────

export const SUBPAGE_BUDGET_MS = 10_000;
export const MAX_SUBPAGES = 4;
type SubKind = 'services' | 'gallery' | 'about';
const KIND_WORDS: Record<SubKind, RegExp> = {
  services: /^(?:services?|menu|pricing|prices?|price[- ]?list|rates)$/i,
  gallery: /^(?:gallery|photos?|portfolio|our[- ]work|work)$/i,
  about: /^(?:about|about[- ]us|our[- ]story|story)$/i,
};
const PAGE_EXT = /\.(?:html?|php|aspx?)$/i;
const NOT_PAGE = /\.(?:jpe?g|png|webp|gif|svg|pdf|zip|mp4|mov|css|js)$/i;

/** Up to 4 same-origin links from the entry page, one each for services, gallery, about (in that order). A link
 *  scores 3 when its last path segment IS the word (services.html, /menu), 2 when its text is, 1 when a one-segment
 *  path contains it; deeper paths ("services/fade.html" cards) never count. */
export function pickSubPages(html: string, pageUrl: string): { kind: SubKind; url: string }[] {
  let base: URL;
  try { base = new URL(pageUrl); } catch { return []; }
  const best: Partial<Record<SubKind, { score: number; url: string }>> = {};
  for (const m of html.matchAll(/<a\b[^>]*\bhref=["']([^"'#]+)(?:#[^"']*)?["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let u: URL;
    try { u = new URL(decodeAll(m[1].trim()), base); } catch { continue; }
    if (u.origin !== base.origin || NOT_PAGE.test(u.pathname)) continue;
    u.hash = '';
    const path = u.pathname.replace(/\/+$/, '');
    if (path === base.pathname.replace(/\/+$/, '') && u.search === base.search) continue;
    const segs = path.split('/').filter(Boolean);
    const last = (segs[segs.length - 1] || '').replace(PAGE_EXT, '');
    const text = clean(m[2].replace(/<[^>]*>/g, ' ')).replace(/[→›»>]+$/, '').trim();
    for (const kind of Object.keys(KIND_WORDS) as SubKind[]) {
      const re = KIND_WORDS[kind];
      let score = 0;
      if (segs.length === 1 && re.test(last)) score = 3;
      else if (segs.length <= 1 && re.test(text.replace(/^(?:all|our|the|see|view)\s+/i, ''))) score = 2;
      else if (segs.length === 1 && last.split(/[-_]/).some((w) => re.test(w))) score = 1;
      if (score > (best[kind]?.score || 0)) best[kind] = { score, url: u.toString() };
    }
  }
  const out: { kind: SubKind; url: string }[] = [];
  const seen = new Set<string>();
  for (const kind of ['services', 'gallery', 'about'] as SubKind[]) {
    const b = best[kind];
    if (b && !seen.has(b.url) && out.length < MAX_SUBPAGES) { seen.add(b.url); out.push({ kind, url: b.url }); }
  }
  return out;
}

interface SubResult { kind: SubKind; html: string; finalUrl: string }

async function fetchSubPages(entryHtml: string, entryUrl: string, deps: SafeFetchDeps): Promise<SubResult[]> {
  const picks = pickSubPages(entryHtml, entryUrl);
  if (!picks.length) return [];
  const timeoutMs = Math.min(deps.timeoutMs ?? SUBPAGE_BUDGET_MS, SUBPAGE_BUDGET_MS);
  const origin = new URL(entryUrl).origin;
  // Same guarded fetch as the entry page (host check, manual redirects re-checked, 3 MB cap); all in parallel, so the
  // 10 s timeout is also the total budget. A failure (or a redirect off the site) just drops that page.
  const settled = await Promise.allSettled(picks.map(async (p): Promise<SubResult> => {
    const r = await fetchPublicHtml(p.url, { ...deps, timeoutMs });
    if (new URL(r.finalUrl).origin !== origin) throw new Error('left the site');
    return { kind: p.kind, html: r.html, finalUrl: r.finalUrl };
  }));
  return settled.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
}

function mergeSubPages(shop: ScrapedShop, subs: SubResult[]): ScrapedShop {
  if (!subs.length) return shop;
  const svcLists: Svc[][] = [shop.services];
  const photos = [...shop.photos];
  let about = '';
  for (const sp of subs) {
    const lines = htmlToLines(sp.html);
    const structured = shopFromStructuredHtml(sp.html);
    svcLists.push((structured?.services || []).map(cleanSvc), mergeServices(servicesFromLines(lines).map(cleanSvc), serviceCardsFromLines(htmlToCardLines(sp.html))));
    photos.push(...[...(structured?.photos || []), ...imagesFrom(sp.html, sp.finalUrl)].map((p) => resolveUrl(p, sp.finalUrl)).filter(isPublicImageUrl));
    if (sp.kind === 'about' && !about) about = aboutTextFromHtml(sp.html);
  }
  const merged: ScrapedShop = { ...shop, services: mergeServices(...svcLists), photos };
  if (about) merged.description = about;
  // finalize rebuilds the payload without the website-only fields, so carry them over.
  const out = finalize(merged, { services: 24, photos: 20 });
  if (shop.email) out.email = shop.email;
  if (shop.logo) out.logo = shop.logo;
  if (shop.socials) out.socials = shop.socials;
  return out;
}

export async function scrapeWebsite(rawUrl: string, opts: ScrapeOptions, deps: SafeFetchDeps = {}): Promise<ScrapedShop> {
  const { html, finalUrl } = await fetchPublicHtml(rawUrl, deps);
  let shop = parseWebsiteHtml(html, finalUrl);
  let wasRendered = false;

  if (!hasShopData(shop) && opts.apifyToken && (!opts.apifyAllow || (await opts.apifyAllow(finalUrl)))) {
    // JS-rendered shell: ONE paid Apify run renders the page; the same readers parse the rendered HTML.
    const rendered = await runApifyWebScraper({ url: finalUrl, pageFunction: galleryPageFunction('', 2500, true), token: opts.apifyToken, label: 'website', timeoutSec: APIFY_WAIT_SEC });
    const renderedHtml = typeof rendered?.html === 'string' ? rendered.html : '';
    if (renderedHtml && renderedHtml.length <= 6 * 1024 * 1024) {
      const second = parseWebsiteHtml(renderedHtml, finalUrl);
      if (second) {
        second.photos = finalize({ ...second, photos: [...second.photos, ...cleanPhotoUrls(rendered?.photos).filter(isPublicImageUrl)] }, { photos: 20 }).photos;
        shop = second;
        wasRendered = true;
      }
    }
  }

  // A static multi-page site keeps services / photos / the story on other pages: read up to 4 of them (never after a
  // JS render: that is the paid path and its pages are rendered, not linked).
  if (shop && hasShopData(shop) && !wasRendered) {
    shop = mergeSubPages(shop, await fetchSubPages(html, finalUrl, deps));
  }

  if (!hasShopData(shop)) {
    throw new ScrapeError(
      "We couldn't find shop details on that page. Try a page that lists your services, or use your booking link.",
      'no_data',
    );
  }
  return shop as ScrapedShop;
}
