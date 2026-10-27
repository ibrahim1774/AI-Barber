// Dev-only: renders the 3 designs with several logo shapes and checks the header at 390 and 1280 wide.
// Run: node_modules/.bin/tsx scripts/logo-size-shots.mts   (uses system Chrome via playwright-core)
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { renderSiteBundle } from '../lib/render/site';

const OUT = '/Users/ibrahim/aibarber-ios/.superpowers/sdd/2026-10-25-customers/logo-size-shots';
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
const site = (template: string, multi: boolean, logo: unknown, shopName = 'Jax Barber Shop') => ({
  shopName, area: 'Brooklyn, NY', phone: '(512) 555-0100', bookingUrl: '/book', template,
  hero: { heading: 'Hello', tagline: '', imageUrl: '' }, about: { heading: 'About', description: [], imageUrl: '' },
  services: [svc('Skin Fade')], gallery: [], contact: { address: '1 Main St, Brooklyn, NY 11201', email: '' },
  ...(multi ? { pages: { order: [], hidden: [] }, extraPages: { on: ['faq'], serviceGuides: true, seed: 1 } } : {}),
  ...(logo ? { logo } : {}),
}) as any;
const URL_ = 'https://storage.googleapis.com/bkt/ios-drafts/abc-123/logo/1-ab.png';
const H: Record<string, [number, number, number]> = { luxe: [48, 72, 12.3], prime: [44, 64, 11.3], euphoria: [44, 64, 11.3] };
const expectH = (d: string, vw: number) => Math.min(H[d][1], Math.max(H[d][0], (H[d][2] * vw) / 100));

const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const fails: string[] = [];
let shots = 0;
const run = async (d: string, multi: boolean, fx: string | null, vw: number, name = 'Jax Barber Shop') => {
  const logo = fx ? { url: URL_, w: FIX[fx].w, h: FIX[fx].h } : null;
  let html = renderSiteBundle(site(d, multi, logo, name), { siteBaseUrl: 'https://x.example.com' }).pages[0].html;
  if (fx) html = html.replaceAll('{{logo}}', 'data:image/png;base64,' + FIX[fx].buf.toString('base64'));
  html = html.replaceAll('{{siteSlug}}', 'x');
  const ctx = await browser.newContext({ viewport: { width: vw, height: 700 } });
  const page = await ctx.newPage();
  await page.addInitScript('window.__name = (f) => f');
  await page.route('**/*', (r: any) => (r.request().resourceType() === 'image' && !r.request().url().startsWith('data:') ? r.abort() : r.continue()));
  await page.setContent(html, { waitUntil: 'load', timeout: 15000 });
  await page.evaluate('window.__name = (f) => f');
  await page.waitForTimeout(900);
  const tag = `${d}-${multi ? 'multi' : 'single'}-${fx ?? 'noname-' + (name.length > 20 ? 'long' : 'jax')}-${vw}`;
  const m = await page.evaluate(() => {
    const doc = document.documentElement;
    const hdr = (document.querySelector('header') ?? document.querySelector('nav')) as HTMLElement;
    const img = hdr.querySelector('img') as HTMLImageElement | null;
    const r = (e: Element) => e.getBoundingClientRect();
    const hb = r(hdr);
    const inView = ['.ab-cta', '.ab-call', '.ab-burger', '.p-cta'].flatMap((s) => [...hdr.querySelectorAll(s)]).filter((e) => (e as HTMLElement).offsetParent !== null).map((e) => ({ s: (e as HTMLElement).className, l: r(e).left, r: r(e).right }));
    const nm = hdr.querySelector('.ab-brand, .ab-name, a.p-serif') as HTMLElement | null;
    return { sw: doc.scrollWidth, iw: innerWidth, img: img ? { h: r(img).height, w: r(img).width, right: r(img).right, left: r(img).left } : null, hb: { t: hb.top, b: hb.bottom, h: hb.height }, inView,
      name: nm && !img ? { sw: nm.scrollWidth, cw: nm.clientWidth, sh: nm.scrollHeight, ch: nm.clientHeight, text: nm.textContent?.trim() } : null };
  });
  if (m.sw > m.iw) fails.push(`${tag}: horizontal overflow ${m.sw}>${m.iw}`);
  for (const e of m.inView) if (e.l < -0.5 || e.r > m.iw + 0.5) fails.push(`${tag}: ${e.s} outside viewport`);
  if (m.img) {
    if (m.img.right > m.iw + 0.5 || m.img.left < -0.5) fails.push(`${tag}: logo outside viewport`);
    const wantH = expectH(d, vw);
    const aspect = FIX[fx!].w / FIX[fx!].h;
    // height is the table value unless the max-width cap (wide logos) makes it shorter
    const cap = d === 'luxe' ? Math.min(0.6 * vw, 320) : Math.min(0.52 * vw, 300);
    const capped = wantH * aspect > cap + 0.5;
    if (!capped && Math.abs(m.img.h - wantH) > 1) fails.push(`${tag}: logo ${m.img.h}px high, want ${wantH}`);
    if (capped && m.img.w > cap + 1) fails.push(`${tag}: logo ${m.img.w}px wide, cap ${cap}`);
  }
  if (m.name) {
    if (name !== 'Jax Barber Shop') { /* long names keep the #268 two-line clamp by design */ } else {
    if (m.name.sw > m.name.cw + 1) fails.push(`${tag}: name clipped horizontally`);
    if (m.name.sh > m.name.ch * 1.15 + 2) fails.push(`${tag}: name clipped vertically`);
    }
  }
  await page.screenshot({ path: path.join(OUT, tag + '.png'), clip: { x: 0, y: 0, width: vw, height: 260 } });
  shots++;
  await ctx.close();
  return m;
};
for (const d of ['luxe', 'prime', 'euphoria']) for (const multi of [true, false]) for (const vw of [390, 1280]) {
  for (const fx of Object.keys(FIX)) await run(d, multi, fx, vw);
  await run(d, multi, null, vw);
  await run(d, multi, null, vw, 'The Very Long Barber Shop Name Co');
}
await browser.close();
console.log(`${shots} screenshots in ${OUT}`);
if (fails.length) { console.log('FAIL\n' + fails.join('\n')); process.exit(1); }
console.log('all assertions passed');
