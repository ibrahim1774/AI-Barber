// Dev-only: renders the 3 designs x multi/single page x 3 header modes (both = logo + name, logo, name) with several logo shapes and
// checks the header at 390 and 1280 wide: no horizontal overflow, the shop name never clipped, logo sizes from LOGO_SIZE.
// Run: node_modules/.bin/tsx scripts/logo-size-shots.mts   (uses system Chrome via playwright-core)
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { renderSiteBundle } from '../lib/render/site';

const OUT = '/Users/ibrahim/aibarber-ios/.superpowers/sdd/2026-10-25-customers/logo-both-shots';
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
const site = (template: string, multi: boolean, logo: unknown, shopName = 'Jax Barber Shop', headerShow?: string) => ({
  shopName, area: 'Brooklyn, NY', phone: '(512) 555-0100', bookingUrl: '/book', template,
  hero: { heading: 'Hello', tagline: '', imageUrl: '' }, about: { heading: 'About', description: [], imageUrl: '' },
  services: [svc('Skin Fade')], gallery: [], contact: { address: '1 Main St, Brooklyn, NY 11201', email: '' },
  ...(multi ? { pages: { order: [], hidden: [] }, extraPages: { on: ['faq'], serviceGuides: true, seed: 1 } } : {}),
  ...(logo ? { logo } : {}),
  ...(headerShow ? { headerShow } : {}),
}) as any;
const URL_ = 'https://storage.googleapis.com/bkt/ios-drafts/abc-123/logo/1-ab.png';
const H: Record<string, Record<'logo' | 'both', [number, number, number]>> = {
  luxe: { logo: [48, 72, 12.3], both: [40, 60, 10.3] }, prime: { logo: [44, 64, 11.3], both: [36, 52, 9.2] }, euphoria: { logo: [44, 64, 11.3], both: [36, 52, 9.2] },
};
const expectH = (d: string, m: 'logo' | 'both', vw: number) => Math.min(H[d][m][1], Math.max(H[d][m][0], (H[d][m][2] * vw) / 100));
type Mode = 'both' | 'logo' | 'name';

const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const fails: string[] = [];
let shots = 0;
const run = async (d: string, multi: boolean, nestedPage: boolean, fx: string | null, mode: Mode, vw: number, name = 'Jax Barber Shop') => {
  const logo = fx ? { url: URL_, w: FIX[fx].w, h: FIX[fx].h } : null;
  const pages = renderSiteBundle(site(d, multi, logo, name, mode === 'both' ? undefined : mode), { siteBaseUrl: 'https://x.example.com' }).pages;
  let html = (nestedPage ? pages.find((p: any) => p.path === 'services/index.html') : pages[0]).html;
  if (fx) html = html.replaceAll('{{logo}}', 'data:image/png;base64,' + FIX[fx].buf.toString('base64'));
  html = html.replaceAll('{{siteSlug}}', 'x');
  const ctx = await browser.newContext({ viewport: { width: vw, height: 700 } });
  const page = await ctx.newPage();
  await page.addInitScript('window.__name = (f) => f');
  await page.route('**/*', (r: any) => (r.request().resourceType() === 'image' && !r.request().url().startsWith('data:') ? r.abort() : r.continue()));
  await page.setContent(html, { waitUntil: 'load', timeout: 15000 });
  await page.evaluate('window.__name = (f) => f');
  await page.waitForTimeout(900);
  const tag = `${d}-${multi ? (nestedPage ? 'nested' : 'multi') : 'single'}-${mode}-${fx ?? 'nologo'}-${name.length > 20 ? 'long' : 'jax'}-${vw}`;
  const m = await page.evaluate(() => {
    const doc = document.documentElement;
    const hdr = (document.querySelector('header') ?? document.querySelector('nav')) as HTMLElement;
    const img = hdr.querySelector('img') as HTMLImageElement | null;
    const r = (e: Element) => e.getBoundingClientRect();
    const hb = r(hdr);
    const inView = ['.ab-cta', '.ab-call', '.ab-burger', '.p-cta'].flatMap((s) => [...hdr.querySelectorAll(s)]).filter((e) => (e as HTMLElement).offsetParent !== null).map((e) => ({ s: (e as HTMLElement).className, l: r(e).left, r: r(e).right }));
    const pair = hdr.querySelector('.ab-pair') as HTMLElement | null;
    const nm = (pair ? pair.querySelector('.ab-brand-name') : hdr.querySelector('.ab-brand, .ab-name, a.p-serif')) as HTMLElement | null;
    const cs = nm ? getComputedStyle(nm) : null;
    return { sw: doc.scrollWidth, iw: innerWidth, hasPair: !!pair, hasImg: !!img, imgAlt: img?.getAttribute('alt') ?? null,
      img: img ? { h: r(img).height, w: r(img).width, right: r(img).right, left: r(img).left } : null,
      brandW: pair ? r(pair).width : 0, hb: { t: hb.top, b: hb.bottom, l: hb.left, r: hb.right }, inView,
      name: nm && cs ? { sw: nm.scrollWidth, cw: nm.clientWidth, sh: nm.scrollHeight, ch: nm.clientHeight, text: nm.textContent?.replace(/\s+/g, ' ').trim(), lines: Math.round(r(nm).height / (parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.1)), top: r(nm).top, bottom: r(nm).bottom, left: r(nm).left, right: r(nm).right, overflow: cs.overflow, clamp: cs.getPropertyValue('-webkit-line-clamp') } : null };
  });
  if (m.sw > m.iw) fails.push(`${tag}: horizontal overflow ${m.sw}>${m.iw}`);
  for (const e of m.inView) if (e.l < -0.5 || e.r > m.iw + 0.5) fails.push(`${tag}: ${e.s} outside viewport`);
  const withLogo = fx && mode !== 'name';
  if (!!m.hasImg !== !!withLogo) fails.push(`${tag}: img present=${m.hasImg}, want ${!!withLogo}`);
  if (m.img) {
    if (m.img.right > m.iw + 0.5 || m.img.left < -0.5) fails.push(`${tag}: logo outside viewport`);
    const wantH = expectH(d, mode as 'logo' | 'both', vw);
    if (mode === 'both') {
      // height is fixed by the table (a narrow box only letterboxes the picture); the width is at most 30% of the brand area
      if (Math.abs(m.img.h - wantH) > 1) fails.push(`${tag}: logo ${m.img.h}px high, want ${wantH}`);
      if (m.img.w > m.brandW * 0.3 + 1 && m.img.w > 28.5) fails.push(`${tag}: logo ${m.img.w}px is more than 30% of the brand area ${m.brandW}`);
      if (m.imgAlt !== '') fails.push(`${tag}: both-mode img alt should be empty`);
    } else {
      const aspect = FIX[fx!].w / FIX[fx!].h;
      const cap = d === 'luxe' ? Math.min(0.6 * vw, 320) : Math.min(0.52 * vw, 300);
      const capped = wantH * aspect > cap + 0.5;
      if (!capped && Math.abs(m.img.h - wantH) > 1) fails.push(`${tag}: logo ${m.img.h}px high, want ${wantH}`);
      if (capped && m.img.w > cap + 1) fails.push(`${tag}: logo ${m.img.w}px wide, cap ${cap}`);
    }
  }
  if (m.name && name === 'Jax Barber Shop' && (mode === 'both' || !fx || mode === 'name')) {
    if (m.name.sw > m.name.cw + 1) fails.push(`${tag}: name clipped horizontally`);
    if (m.name.sh > m.name.ch * 1.15 + 2) fails.push(`${tag}: name clipped vertically`);
    if (m.name.top < m.hb.t - 0.5 || m.name.bottom > m.hb.b + 0.5 || m.name.left < m.hb.l - 0.5 || m.name.right > m.hb.r + 0.5) fails.push(`${tag}: name outside the header box`);
    if (mode === 'both') {
      if (!/jax\s*barber\s*shop/i.test(m.name.text ?? '')) fails.push(`${tag}: name text is "${m.name.text}"`);
      if (m.name.overflow !== 'visible' || (m.name.clamp && m.name.clamp !== 'none')) fails.push(`${tag}: both-mode name has overflow ${m.name.overflow} / clamp ${m.name.clamp}`);
      if (m.name.lines > (vw < 340 ? 3 : 2)) fails.push(`${tag}: name takes ${m.name.lines} lines`);
    }
  }
  // the long name in both mode may take a third line but is never clipped
  if (m.name && name !== 'Jax Barber Shop' && mode === 'both') {
    if (m.name.sw > m.name.cw + 1 || m.name.sh > m.name.ch + 2) fails.push(`${tag}: long name clipped`);
    if (m.name.bottom > m.hb.b + 0.5) fails.push(`${tag}: long name outside the header box`);
  }
  await page.screenshot({ path: path.join(OUT, tag + '.png'), clip: { x: 0, y: 0, width: vw, height: 260 } });
  shots++;
  await ctx.close();
  return m;
};
const VW = (process.env.VW ?? '390,1280').split(',').map(Number);
for (const d of ['luxe', 'prime', 'euphoria']) for (const [multi, nested] of [[true, false], [true, true], [false, false]] as const) for (const vw of VW) {
  for (const fx of Object.keys(FIX)) for (const mode of ['both', 'logo', 'name'] as Mode[]) await run(d, multi, nested, fx, mode, vw);
  await run(d, multi, nested, null, 'name', vw);
  await run(d, multi, nested, 'square', 'both', vw, 'The Very Long Barber Shop Name Co');
  await run(d, multi, nested, 'wide', 'both', vw, 'The Very Long Barber Shop Name Co');
}
await browser.close();
console.log(`${shots} screenshots in ${OUT}`);
if (fails.length) { console.log('FAIL\n' + fails.join('\n')); process.exit(1); }
console.log('all assertions passed');
