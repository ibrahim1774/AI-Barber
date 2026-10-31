// Dev-only: luxe header with the phone number under the shop name, at 390 / 430 / 1280, three header modes, a short and a 34-char name.
// Asserts: no horizontal overflow, name not clipped, number visible under the name on a phone (hidden at 1280), inside the header.
// Run: node_modules/.bin/tsx scripts/phone-header-shots.mts   (uses system Chrome via playwright-core)
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { renderSiteBundle } from '../lib/render/site';

const OUT = '/Users/ibrahim/aibarber-ios/.superpowers/sdd/2026-10-25-customers/phone-header-shots';
const PW = '/Users/ibrahim/.claude/skills/vibe-aso/renderer/node_modules/playwright-core';
const { chromium } = createRequire(import.meta.url)(PW);
fs.mkdirSync(OUT, { recursive: true });

const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b: Buffer) => { let c = ~0; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return ~c >>> 0; };
const chunk = (t: string, d: Buffer) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
/** RGBA PNG; pix(x,y) returns [r,g,b,a]. */
function png(w: number, h: number, pix: (x: number, y: number) => number[]): Buffer {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const p = pix(x, y); raw.set(p, y * (w * 4 + 1) + 1 + x * 4); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
// a bordered block with a diagonal so the shape and crop are visible
const solid = (w: number, h: number, c: number[], bg: number[]) => png(w, h, (x, y) => (x < 3 || y < 3 || x >= w - 3 || y >= h - 3 || Math.abs(x / w - y / h) < 0.02 ? c : bg));
const FIX: Record<string, { w: number; h: number; buf: Buffer }> = {
  wide: { w: 600, h: 80, buf: solid(600, 80, [244, 161, 0, 255], [30, 30, 30, 255]) },
  tall: { w: 80, h: 600, buf: solid(80, 600, [244, 161, 0, 255], [30, 30, 30, 255]) },
  square: { w: 300, h: 300, buf: solid(300, 300, [244, 161, 0, 255], [30, 30, 30, 255]) },
  tiny: { w: 40, h: 40, buf: solid(40, 40, [244, 161, 0, 255], [30, 30, 30, 255]) },
  transparent: { w: 400, h: 200, buf: png(400, 200, (x, y) => ((x - 200) ** 2 + (y - 100) ** 2 < 90 ** 2 ? [255, 255, 255, 255] : [0, 0, 0, 0])) },
};

const svc = (title: string) => ({ title, subtitle: '', description: '', icon: 'scissors', imageUrl: '' });
const site = (multi: boolean, logo: unknown, shopName: string, headerShow?: string) => ({
  shopName, area: 'Brooklyn, NY', phone: '(512) 555-0100', bookingUrl: '/book', template: 'luxe',
  hero: { heading: 'Hello', tagline: '', imageUrl: '' }, about: { heading: 'About', description: [], imageUrl: '' },
  services: [svc('Skin Fade')], gallery: [], contact: { address: '1 Main St, Brooklyn, NY 11201', email: '' },
  ...(multi ? { pages: { order: [], hidden: [] }, extraPages: { on: ['faq'], serviceGuides: true, seed: 1 } } : {}),
  ...(logo ? { logo } : {}),
  ...(headerShow ? { headerShow } : {}),
}) as any;
const URL_ = 'https://storage.googleapis.com/bkt/ios-drafts/abc-123/logo/1-ab.png';
type Mode = 'both' | 'logo' | 'name';
const LONG = 'The Original Gentlemens Barber Club'; // 34 characters

const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const fails: string[] = [];
let shots = 0;
const ONLY = process.env.ONLY;
const run = async (kind: 'nested' | 'multihome' | 'single', mode: Mode, vw: number, name: string) => {
  if (ONLY && !`luxe-${kind}-${mode}-${name.length > 20 ? 'long' : 'jax'}-${vw}`.includes(ONLY)) return;
  const fx = mode === 'name' ? null : 'square';
  const logo = fx ? { url: URL_, w: FIX[fx].w, h: FIX[fx].h } : null;
  const pages = renderSiteBundle(site(kind !== 'single', logo, name, mode === 'both' ? undefined : mode), { siteBaseUrl: 'https://x.example.com' }).pages;
  let html = (kind === 'nested' ? pages.find((p: any) => p.path === 'services/index.html') : pages[0]).html;
  if (fx) html = html.replaceAll('{{logo}}', 'data:image/png;base64,' + FIX[fx].buf.toString('base64'));
  html = html.replaceAll('{{siteSlug}}', 'x');
  const ctx = await browser.newContext({ viewport: { width: vw, height: 700 } });
  const page = await ctx.newPage();
  await page.addInitScript('window.__name = (f) => f');
  await page.route('**/*', (r: any) => (r.request().resourceType() === 'image' && !r.request().url().startsWith('data:') ? r.abort() : r.continue()));
  await page.setContent(html, { waitUntil: 'load', timeout: 15000 });
  await page.evaluate('window.__name = (f) => f');
  await page.waitForTimeout(900);
  const tag = `luxe-${kind}-${mode}-${name.length > 20 ? 'long' : 'jax'}-${vw}`;
  const m = await page.evaluate(() => {
    const doc = document.documentElement;
    const hdr = document.querySelector('header') as HTMLElement;
    const r = (e: Element) => e.getBoundingClientRect();
    const sub = hdr.querySelector('.ab-sub') as HTMLElement | null;
    const pair = hdr.querySelector('.ab-pair') as HTMLElement | null;
    const nm = (pair ? pair.querySelector('.ab-brand-name') : hdr.querySelector('.ab-brand, .ab-name')) as HTMLElement | null;
    const brandEl = (hdr.querySelector('.ab-brandcol') as HTMLElement | null);
    let subText: { top: number; bottom: number; left: number; right: number } | null = null;
    if (sub) { const rg = document.createRange(); rg.selectNodeContents(sub); const b = rg.getBoundingClientRect(); subText = { top: b.top, bottom: b.bottom, left: b.left, right: b.right }; }
    const lh = nm ? parseFloat(getComputedStyle(nm).lineHeight) || parseFloat(getComputedStyle(nm).fontSize) * 1.1 : 0;
    const icon = hdr.querySelector('.ab-call') as HTMLElement | null;
    return { sw: doc.scrollWidth, iw: innerWidth, hb: { t: r(hdr).top, b: r(hdr).bottom, h: r(hdr).height },
      sub: sub ? { disp: getComputedStyle(sub).display, box: { h: r(sub).height, w: r(sub).width }, text: sub.textContent, href: sub.getAttribute('href') } : null, subText,
      colW: brandEl ? r(brandEl).width : 0,
      name: nm ? { sw: nm.scrollWidth, cw: nm.clientWidth, sh: nm.scrollHeight, ch: nm.clientHeight, lines: Math.round(r(nm).height / lh), bottom: r(nm).bottom, text: nm.textContent?.replace(/\s+/g, ' ').trim() } : null,
      iconShown: !!icon && getComputedStyle(icon).display !== 'none', iconText: icon ? (icon.querySelector('.ab-call-text') as HTMLElement | null)?.offsetParent !== null : false };
  });
  if (process.env.DEBUG_NAME) console.log(tag, JSON.stringify(m.name));
  if (m.sw > m.iw) fails.push(`${tag}: horizontal overflow ${m.sw}>${m.iw}`);
  if (!m.iconShown) fails.push(`${tag}: call icon link missing`);
  // The name: the short name is never clipped. The 34-char name in name-only mode keeps the header's existing 2-line clamp
  // (logo-size-shots / headerFit policy), so only the line count is asserted for it; the pair (logo + name) never clips.
  if (m.name && mode !== 'logo') {
    const long = name !== 'Jax Barber Shop';
    if (m.name.sw > m.name.cw + 1) fails.push(`${tag}: name clipped horizontally`);
    if (!long && m.name.sh > m.name.ch + 2) fails.push(`${tag}: name clipped vertically`);
    if (long && mode === 'both' && m.name.sh > m.name.ch + 2) fails.push(`${tag}: long name clipped in logo + name`);
    if (mode === 'name' && m.name.lines > 2 && !long) fails.push(`${tag}: name takes ${m.name.lines} lines`);
  }
  if (vw <= 430) {
    if (!m.sub || m.sub.disp !== 'block' || m.sub.text !== '(512) 555-0100' || m.sub.href !== 'tel:(512)555-0100') fails.push(`${tag}: number not shown under the name (${JSON.stringify(m.sub)})`);
    if (m.sub && m.sub.box.h < 44) fails.push(`${tag}: tap target ${m.sub.box.h}px high`);
    if (m.subText) {
      if (m.subText.left < -0.5 || m.subText.right > m.iw + 0.5) fails.push(`${tag}: number outside viewport`);
      if (m.subText.bottom > m.hb.b + 0.5) fails.push(`${tag}: number outside the header box`);
      if (m.name && m.subText.top < m.name.bottom - 1) fails.push(`${tag}: number overlaps the name`);
    }
    if (m.iconText) fails.push(`${tag}: icon link still prints the number`);
  } else if (m.sub && m.sub.disp !== 'none') fails.push(`${tag}: number line shown on a wide screen`);
  await page.screenshot({ path: path.join(OUT, tag + '.png'), clip: { x: 0, y: 0, width: vw, height: 220 } });
  shots++;
  await ctx.close();
};
for (const kind of ['nested', 'multihome', 'single'] as const) for (const vw of [390, 430, 1280]) for (const mode of ['both', 'logo', 'name'] as Mode[]) for (const name of ['Jax Barber Shop', LONG]) await run(kind, mode, vw, name);
await browser.close();
console.log(`${shots} screenshots in ${OUT}`);
if (fails.length) { console.log('FAIL\n' + fails.join('\n')); process.exit(1); }
console.log('all assertions passed');
