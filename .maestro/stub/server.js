#!/usr/bin/env node
// Local stand-in for aibarber.org (/api/*) AND the Supabase project (/auth/v1, /rest/v1) so the E2E run
// can never write to a live service. No dependencies. Usage: node server.js [port]   (default 8787)
// Control: GET /__e2e/log | /__e2e/state ; POST /__e2e/reset ; POST /__e2e/fail {path,status,error,times}
const http = require('http');
const zlib = require('zlib');
const crypto = require('crypto');
const PORT = Number(process.argv[2] || process.env.STUB_PORT || 8787);
const SELF = `http://127.0.0.1:${PORT}`;
const uuid = () => crypto.randomUUID();
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

let S;
function reset() {
  S = { users: [], tables: {}, files: {}, sites: {}, byTx: {}, tier: null, log: [], fails: [], version: 0 };
  S.users.push({ id: uuid(), email: 'qa@example.com', password: 'Passw0rd!' });
}
reset();

// ---------- images (solid-colour PNGs generated here, no network) ----------
function png(w, h, [r, g, b]) {
  const crcT = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
  const crc = (buf) => { let c = 0xffffffff; for (const x of buf) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.alloc(1 + w * 3); for (let x = 0; x < w; x++) { row[1 + x * 3] = r; row[2 + x * 3] = g; row[3 + x * 3] = b; }
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const COLORS = [[120, 80, 50], [60, 90, 130], [90, 120, 80], [140, 60, 70], [100, 100, 100], [150, 120, 40], [70, 50, 110], [40, 110, 110]];
const photo = (i) => `${SELF}/img/${i}.png`;

// ---------- canned content ----------
const BUSINESS = {
  shopName: "Jack's Barbershop", area: 'Austin, TX', address: '123 Main St, Austin, TX 78701', phone: '(512) 555-0142',
  description: 'Classic cuts and hot-towel shaves in the heart of Austin.',
  photos: [0, 1, 2, 3, 4, 5].map(photo),
  services: [
    { title: "Men's Haircut", price: '$30', duration: '30 min', category: 'Haircuts' },
    { title: 'Beard Trim', price: '$15', duration: '15 min', category: 'Beard' },
    { title: 'Hot Towel Shave', price: '$35', duration: '40 min', category: 'Shave' },
  ],
  reviews: [{ author: 'Marcus T.', rating: 5, text: 'Best fade in Austin. Jack is a pro.', date: '2026-08-01' }, { author: 'Dee R.', rating: 5, text: 'Clean shop, great vibe.', date: '2026-07-12' }],
  hours: [{ day: 'Monday', open: '9:00 AM', close: '6:00 PM' }, { day: 'Tuesday', open: '9:00 AM', close: '6:00 PM' }, { day: 'Sunday', open: '', close: '', closed: true }],
  staff: [], aggregateRating: { ratingValue: 4.9, reviewCount: 212 },
};
const MATCH = { name: "Jack's Barbershop", address: '123 Main St, Austin, TX', photoUrl: photo(0), rating: 4.9, ratingCount: 212, category: 'Barber shop' };

// ---------- helpers ----------
const send = (res, status, body, type = 'application/json', extra = {}) => {
  const out = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  res.writeHead(status, { 'Content-Type': type, 'Content-Length': out.length, 'Access-Control-Allow-Origin': '*', ...extra });
  res.end(out);
};
const jwt = (u) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: u.id, email: u.email, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })}.stubsig`;
const session = (u) => ({ access_token: jwt(u), token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: `r_${u.id}`, user: userJson(u) });
const userJson = (u) => ({ id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, email_confirmed_at: new Date().toISOString(), app_metadata: { provider: 'email' }, user_metadata: u.meta || {}, created_at: new Date().toISOString() });
const bearerUser = (req) => { const t = (req.headers.authorization || '').replace(/^Bearer /, ''); try { const p = JSON.parse(Buffer.from(t.split('.')[1], 'base64url')); return S.users.find((u) => u.id === p.sub) || null; } catch { return null; } };
const tierOf = (tx) => ({ 1: 'website', 2: 'bookings', 3: 'store' })[String(tx || '')[8]] || null;
const RANK = { website: 1, bookings: 2, store: 3 };
const bumpTier = (tx) => { const t = tierOf(tx); if (t && (!S.tier || RANK[t] > RANK[S.tier])) S.tier = t; };
const plan = () => ({ linked: !!S.tier, tier: S.tier, entitlements: { hosting: !!S.tier, bookings: RANK[S.tier] >= 2, store: RANK[S.tier] >= 3 }, active: !!S.tier, expiresAt: S.tier ? new Date(Date.now() + 365 * 864e5).toISOString() : null, takenDownAt: null, revoked: false });
const slugOf = (s) => String(s || 'site').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'site';

// ---------- PostgREST emulator ----------
function filterRows(rows, q) {
  let out = rows;
  for (const [k, v] of q.entries()) {
    if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(k)) continue;
    if (k === 'or' || k === 'and') continue; // visibility filters: ignore (RLS is not emulated)
    const m = /^(not\.)?(eq|neq|in|is|gt|gte|lt|lte)\.(.*)$/.exec(v); if (!m) continue;
    const [, not, op, val] = m;
    const test = (r) => {
      const x = r[k];
      switch (op) {
        case 'eq': return String(x) === val; case 'neq': return String(x) !== val;
        case 'in': return val.replace(/^\(|\)$/g, '').split(',').map((s) => s.replace(/^"|"$/g, '')).includes(String(x));
        case 'is': return val === 'null' ? x == null : String(x) === val;
        case 'gt': return x > val; case 'gte': return x >= val; case 'lt': return x < val; case 'lte': return x <= val;
      }
    };
    out = out.filter((r) => (not ? !test(r) : test(r)));
  }
  const ord = q.get('order');
  if (ord) { const [col, dir] = ord.split(',')[0].split('.'); out = [...out].sort((a, b) => (a[col] > b[col] ? 1 : a[col] < b[col] ? -1 : 0) * (dir === 'desc' ? -1 : 1)); }
  if (q.get('limit')) out = out.slice(0, Number(q.get('limit')));
  return out;
}
const DEFAULTS = {
  ab_shops: () => ({ bookings_enabled: false, pay_in_shop: true, platform_fee_bps: 200, lead_days: 30, min_notice_min: 120, buffer_min: 0, cancel_cutoff_min: 120, daily_summary: false }),
  ab_services: () => ({ bookable: true, show_on_site: true, deposit_type: 'none', active: true, sort: 0 }),
  ab_members: () => ({ active: true, role: 'barber', ics_token: uuid().slice(0, 12) }),
  ab_products: () => ({ active: true }),
};
function rest(req, res, table, url, body) {
  const rows = (S.tables[table] = S.tables[table] || []);
  const q = url.searchParams;
  const wantObj = /vnd\.pgrst\.object/.test(req.headers.accept || '');
  const prefer = req.headers.prefer || '';
  const ret = (data, status = 200) => {
    if (wantObj) { if (data.length !== 1) return send(res, 406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: `The result contains ${data.length} rows`, hint: null }); return send(res, status, data[0]); }
    return send(res, status, data);
  };
  if (req.method === 'GET' || req.method === 'HEAD') return ret(filterRows(rows, q));
  if (req.method === 'POST') {
    const list = Array.isArray(body) ? body : [body];
    const out = [];
    for (const item of list) {
      const conflict = (q.get('on_conflict') || '').split(',').filter(Boolean);
      const key = conflict.length ? conflict : (/resolution=merge/.test(prefer) ? ['id'] : []);
      let ex = key.length && key.every((c) => item[c] !== undefined) ? rows.find((r) => key.every((c) => String(r[c]) === String(item[c]))) : null;
      if (ex) { Object.assign(ex, item); out.push(ex); continue; }
      const row = { id: uuid(), created_at: new Date().toISOString(), ...(DEFAULTS[table] ? DEFAULTS[table]() : {}), ...item };
      rows.push(row); out.push(row);
    }
    return /return=representation/.test(prefer) ? ret(out, 201) : send(res, 201, '', 'application/json');
  }
  if (req.method === 'PATCH') { const hit = filterRows(rows, q); hit.forEach((r) => Object.assign(r, body)); return /return=representation/.test(prefer) ? ret(hit) : send(res, 204, ''); }
  if (req.method === 'DELETE') { const hit = new Set(filterRows(rows, q)); S.tables[table] = rows.filter((r) => !hit.has(r)); return send(res, 204, ''); }
  return send(res, 405, { message: 'method' });
}

// ---------- routes ----------
const NOT_DEPLOYED = '<!DOCTYPE html><html><head><title>404: NOT_FOUND</title></head><body><h1>404: NOT_FOUND</h1><p>Code: NOT_FOUND</p><p>ID: iad1::e2e-not-deployed</p></body></html>';

async function route(req, res, url, body) {
  const p = url.pathname;
  // control plane
  if (p === '/__e2e/reset') { reset(); return send(res, 200, { ok: true }); }
  if (p === '/__e2e/log') return send(res, 200, S.log);
  if (p === '/__e2e/state') return send(res, 200, { tier: S.tier, users: S.users.map((u) => u.email), tables: Object.fromEntries(Object.entries(S.tables).map(([k, v]) => [k, v.length])), sites: Object.keys(S.sites) });
  if (p === '/__e2e/fail') { S.fails.push({ path: body.path, status: body.status || 500, error: body.error || 'e2e-forced', times: body.times || 1 }); return send(res, 200, { ok: true }); }
  const f = S.fails.find((x) => x.path === p && x.times > 0);
  if (f) { f.times--; return send(res, f.status, { error: f.error }); }

  if (req.method === 'OPTIONS') return send(res, 204, '');
  // images + uploads
  let m;
  if ((m = /^\/img\/(\d+)\.png$/.exec(p))) return send(res, 200, png(600, 400, COLORS[Number(m[1]) % COLORS.length]), 'image/png');
  if (p === '/api/get-upload-urls') {
    const urls = (body.filenames || []).map((fn) => ({ filename: fn, signedUrl: `${SELF}/upload/${body.siteId}/${fn}`, publicUrl: `${SELF}/public/${body.siteId}/${fn}` }));
    return send(res, 200, { urls });
  }
  if ((m = /^\/upload\/(.+)$/.exec(p)) && (req.method === 'PUT' || req.method === 'POST')) { S.files[m[1]] = { buf: req.rawBody, type: req.headers['content-type'] || 'image/jpeg' }; return send(res, 200, { ok: true }); }
  if ((m = /^\/public\/(.+)$/.exec(p))) { const fl = S.files[m[1]]; return fl ? send(res, 200, fl.buf, fl.type) : send(res, 404, { error: 'not-found' }); }
  if ((m = /^\/site\/([^/]+)/.exec(p))) { const s = S.sites[m[1]]; return s ? send(res, 200, `<!doctype html><title>${s.shopName}</title><h1>${s.shopName}</h1><p>Stub-hosted preview (version ${s.version}).</p>`, 'text/html') : send(res, 404, NOT_DEPLOYED, 'text/html'); }
  if (p === '/stripe-stub') return send(res, 200, '<!doctype html><title>Stripe (stub)</title><h1>Stripe onboarding (E2E stub)</h1><p>No real Stripe.</p>', 'text/html');

  // Supabase GoTrue
  if (p === '/auth/v1/signup') {
    if (S.users.find((u) => u.email === body.email)) return send(res, 422, { code: 422, error_code: 'user_already_exists', msg: 'User already registered' });
    if (!body.password || body.password.length < 6) return send(res, 422, { code: 422, error_code: 'weak_password', msg: 'Password should be at least 6 characters.' });
    const u = { id: uuid(), email: body.email, password: body.password, meta: body.data || {} }; S.users.push(u);
    return send(res, 200, session(u));
  }
  if (p === '/auth/v1/token') {
    const gt = url.searchParams.get('grant_type');
    if (gt === 'password') { const u = S.users.find((x) => x.email === body.email && x.password === body.password); return u ? send(res, 200, session(u)) : send(res, 400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' }); }
    if (gt === 'refresh_token') { const u = S.users.find((x) => `r_${x.id}` === body.refresh_token); return u ? send(res, 200, session(u)) : send(res, 400, { code: 400, error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' }); }
  }
  if (p === '/auth/v1/user') { const u = bearerUser(req); if (!u) return send(res, 401, { code: 401, error_code: 'bad_jwt', msg: 'invalid JWT' }); if (req.method === 'PUT') { if (body.password) u.password = body.password; } return send(res, 200, userJson(u)); }
  if (p === '/auth/v1/logout') return send(res, 204, '');
  if (p === '/auth/v1/recover' || p === '/auth/v1/verify' || p === '/auth/v1/otp') return send(res, 200, {});
  if ((m = /^\/rest\/v1\/([a-z_]+)$/.exec(p))) return rest(req, res, m[1], url, body);

  // aibarber.org /api
  if (p === '/api/find-business') return send(res, 200, { candidates: [
    { title: "Jack's Barbershop", address: '123 Main St, Austin, TX', category: 'Barber shop', placeId: 'stub-place-1', rating: 4.9, reviews: 212 },
    { title: "Jackson's Cuts", address: '9 Elm Ave, Austin, TX', category: 'Barber shop', placeId: 'stub-place-2', rating: 4.5, reviews: 40 }], searchedNear: body.near || 'Austin, TX' });
  if (p === '/api/places-autocomplete') return send(res, 200, { suggestions: [{ text: 'Austin, TX, USA', placeId: 'stub-a' }, { text: 'Austin, MN, USA', placeId: 'stub-b' }] });
  if (p === '/api/import-business') return send(res, 200, { ...BUSINESS, _platform: 'gbp', _categories: ['Barber shop'], match: MATCH });
  if (p === '/api/import-scrape') return send(res, 200, { ...BUSINESS, bookingUrl: body.url, _platform: 'booksy' });
  if (p === '/api/ios/publish') {
    const bad = JSON.stringify(body.siteData || {}).includes('"data:');
    if (!body.transactionId || !body.siteData?.hero || !body.siteData?.about || !Array.isArray(body.siteData?.gallery) || !Array.isArray(body.siteData?.services) || bad) return send(res, 400, { error: 'bad-request' });
    bumpTier(body.transactionId);
    const slug = slugOf(body.siteData.shopName);
    const had = !!S.byTx[body.transactionId];
    const version = ++S.version;
    S.sites[slug] = { shopName: body.siteData.shopName, version };
    S.byTx[body.transactionId] = { siteId: slug, deployedUrl: `${SELF}/site/${slug}`, siteData: body.siteData, version };
    return send(res, 200, { siteId: slug, deployedUrl: `${SELF}/site/${slug}`, republished: had, version, editedBy: 'owner', editedAt: new Date().toISOString() });
  }
  if (p === '/api/ios/site') { const r = S.byTx[body.transactionId]; return r ? send(res, 200, { ...r, active: true, editedBy: 'owner' }) : send(res, 404, { error: 'not-found' }); }
  if (p === '/api/shop/plan') { if (!bearerUser(req)) return send(res, 401, { error: 'unauthorized' }); if (req.method === 'POST') bumpTier(body.transactionId); return send(res, 200, plan()); }
  if (p === '/api/shop/setup') {
    const u = bearerUser(req); if (!u) return send(res, 401, { error: 'unauthorized' });
    if (!body.siteId || !body.name || !Array.isArray(body.services)) return send(res, 400, { error: 'invalid' });
    const shops = (S.tables.ab_shops = S.tables.ab_shops || []);
    let shop = shops.find((s) => s.owner_id === u.id);
    if (!shop) {
      shop = { id: uuid(), owner_id: u.id, slug: slugOf(body.name), name: body.name, timezone: body.timezone, address: body.address || null, phone: body.phone || null, ios_otid: body.transactionId || null, site_base_url: null, ...DEFAULTS.ab_shops(), created_at: new Date().toISOString() };
      shops.push(shop);
      (S.tables.ab_members = S.tables.ab_members || []).push({ id: uuid(), shop_id: shop.id, role: 'owner', display_name: 'Jack', sort: 0, ...DEFAULTS.ab_members(), role: 'owner' });
      body.services.forEach((s, i) => (S.tables.ab_services = S.tables.ab_services || []).push({ id: uuid(), shop_id: shop.id, name: s.name, price_cents: s.priceCents, duration_min: s.durationMin, description: s.description || null, photo_url: s.photoUrl || null, sort: i, ...DEFAULTS.ab_services() }));
    } else if (body.transactionId) shop.ios_otid = body.transactionId;
    return send(res, 200, { shop: { id: shop.id, slug: shop.slug } });
  }
  if (p === '/api/shop/stripe/onboard') return send(res, 200, { url: `${SELF}/stripe-stub` });
  if (p === '/api/shop/stripe/status') return send(res, 200, { connected: false, chargesEnabled: false, detailsSubmitted: false });
  if (p === '/api/shop/push-token' || p === '/api/sync-auth-phone' || p === '/api/ios/delete-account') return send(res, 200, { ok: true });
  if (p.startsWith('/api/ios/domain/')) return send(res, 404, NOT_DEPLOYED, 'text/html'); // "server not deployed"
  if (p === '/api/shop/time-off') return send(res, 200, { conflicts: [] });
  if (p.startsWith('/api/shop/')) return send(res, 200, { ok: true, appointment: {} });
  if (p === '/privacy' || p === '/terms') return send(res, 200, `<!doctype html><title>${p}</title><h1>${p} (stub)</h1>`, 'text/html');
  return send(res, 501, { error: 'e2e-stub-unhandled', method: req.method, path: p });
}

http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', async () => {
    req.rawBody = Buffer.concat(chunks);
    const url = new URL(req.url, SELF);
    let body = {};
    try { body = req.rawBody.length && /json/.test(req.headers['content-type'] || '') ? JSON.parse(req.rawBody.toString()) : {}; } catch { body = {}; }
    const t = Date.now();
    try { await route(req, res, url, body); } catch (e) { console.error(e); send(res, 500, { error: String(e) }); }
    if (!url.pathname.startsWith('/__e2e') && !url.pathname.startsWith('/img/')) {
      const line = `${new Date().toISOString()} ${req.method} ${url.pathname}${url.search} -> ${res.statusCode} (${Date.now() - t}ms)`;
      S.log.push(line); console.log(line);
    }
  });
}).listen(PORT, '127.0.0.1', () => console.log(`E2E stub listening on ${SELF}`));
