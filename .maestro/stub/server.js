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
  S = { users: [], tables: {}, files: {}, sites: {}, byTx: {}, tier: null, log: [], fails: [], faults: [], version: 0, kv: {}, sw: { status: 'INACTIVE', ents: [], subs: [], n: 0 }, lapsedDays: null, memberLimit: null, memberReport: null, memberProfile: true, stripe: { connected: false, chargesEnabled: false, detailsSubmitted: false } };
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
const plan = () => S.lapsedDays != null && S.tier
  ? { linked: true, tier: S.tier, entitlements: { hosting: false, bookings: false, store: false }, active: false, expiresAt: new Date(Date.now() - S.lapsedDays * 864e5).toISOString(), takenDownAt: null, revoked: false, capabilities: { memberProfile: S.memberProfile } }
  : { linked: !!S.tier, tier: S.tier, entitlements: { hosting: !!S.tier, bookings: RANK[S.tier] >= 2, store: RANK[S.tier] >= 3 }, active: !!S.tier, expiresAt: S.tier ? new Date(Date.now() + 365 * 864e5).toISOString() : null, takenDownAt: null, revoked: false, capabilities: { memberProfile: S.memberProfile } };
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
  let m;
  // control plane
  if (p === '/__e2e/reset') { reset(); return send(res, 200, { ok: true }); }
  if (p === '/__e2e/log') return send(res, 200, S.log);
  if (p === '/__e2e/state') return send(res, 200, { tier: S.tier, users: S.users.map((u) => u.email), tables: Object.fromEntries(Object.entries(S.tables).map(([k, v]) => [k, v.length])), sites: Object.keys(S.sites) });
  if (p === '/__e2e/fail') { S.fails.push({ path: body.path, status: body.status || 500, error: body.error || 'e2e-forced', times: body.times || 1 }); return send(res, 200, { ok: true }); }
  // ---- E2E session seeding (replaces typing into the secure password field) ----
  // expo-secure-store is swapped for a shim (secure-store-e2e.js) that keeps the Supabase session HERE, so
  //   POST /__e2e/signin {email?}  -> signs the user in (session written under sb-127-auth-token); relaunch the app to pick it up
  //   POST /__e2e/signout          -> drops it (what the app's own Sign out does through the shim as well)
  //   POST /__e2e/lapse {days}     -> plan lapsed `days` ago (null/absent = active again); Superwall stand-in goes INACTIVE
  //   POST /__e2e/tier {tier}      -> grant a tier server-side + in the Superwall stand-in (website|bookings|store)
  //   POST /__e2e/stripe {...}     -> what /api/shop/stripe/status reports
  if ((m = /^\/__e2e\/kv\/(.+)$/.exec(p))) {
    const k = decodeURIComponent(m[1]);
    if (req.method === 'PUT') { S.kv[k] = req.rawBody.toString(); return send(res, 200, { ok: true }); }
    if (req.method === 'DELETE') { delete S.kv[k]; return send(res, 200, { ok: true }); }
    return k in S.kv ? send(res, 200, S.kv[k], 'text/plain') : send(res, 404, 'none', 'text/plain');
  }
  if (p === '/__e2e/signin') {
    const email = body.email || 'qa@example.com';
    let u = S.users.find((x) => x.email === email);
    if (!u) { u = { id: uuid(), email, password: 'Passw0rd!' }; S.users.push(u); }
    S.kv['sb-127-auth-token'] = JSON.stringify(session(u));
    return send(res, 200, { ok: true, userId: u.id });
  }
  if (p === '/__e2e/signout') { delete S.kv['sb-127-auth-token']; return send(res, 200, { ok: true }); }
  if (p === '/__e2e/sw') {
    if (req.method === 'POST') S.sw = body;
    return send(res, 200, S.sw);
  }
  if (p === '/__e2e/tier') {
    const ents = { website: ['hosting'], bookings: ['hosting', 'bookings'], store: ['hosting', 'bookings', 'store'] }[body.tier] || [];
    S.tier = body.tier || null; S.lapsedDays = null;
    // keep the subscription the app already bought (the site is bound to its transaction id); only widen the entitlements
    const subs = S.sw.subs.length || !ents.length ? S.sw.subs : [{ transactionId: `20000000${RANK[body.tier]}900`, productId: `com.ibrahim1774.aibarber.${body.tier}.yearly`, purchaseDate: new Date().toISOString(), isActive: true, isRevoked: false, expirationDate: new Date(Date.now() + 365 * 864e5).toISOString() }];
    S.sw = { status: ents.length ? 'ACTIVE' : 'INACTIVE', ents, n: S.sw.n, subs };
    return send(res, 200, S.sw);
  }
  if (p === '/__e2e/lapse') {
    S.lapsedDays = body.days == null ? null : Number(body.days);
    if (S.lapsedDays != null) S.sw = { ...S.sw, status: 'INACTIVE', ents: [], subs: S.sw.subs.map((x) => ({ ...x, isActive: false, expirationDate: new Date(Date.now() - S.lapsedDays * 864e5).toISOString() })) };
    return send(res, 200, { lapsedDays: S.lapsedDays });
  }
  if (p === '/__e2e/siteBase') { S.siteBase = body.url || null; (S.tables.ab_shops || []).forEach((r) => (r.site_base_url = S.siteBase)); return send(res, 200, { siteBase: S.siteBase }); }   // POST {url}: the server's stored site base (https host, no path)
  if (p === '/__e2e/booking') {   // POST {name, hours} : a customer booking (as the booking page would write it) starting in `hours` hours
    const shop = (S.tables.ab_shops || [])[0]; if (!shop) return send(res, 409, { error: 'no shop yet' });
    const mem = (S.tables.ab_members || []).find((x) => x.shop_id === shop.id), sv = (S.tables.ab_services || []).find((x) => x.shop_id === shop.id);
    const start = new Date(Date.now() + (body.hours || 3) * 36e5); start.setMinutes(0, 0, 0);
    const row = { id: uuid(), shop_id: shop.id, member_id: mem.id, service_id: sv.id, start_at: start.toISOString(), end_at: new Date(start.getTime() + sv.duration_min * 6e4).toISOString(), service_name: sv.name, price_cents: sv.price_cents ?? null, duration_min: sv.duration_min, customer_name: body.name || 'Marcus T.', customer_phone: '(512) 555-0199', customer_email: null, note: null, status: 'booked', payment_status: 'none', payment_method: null, amount_paid_cents: 0, customer_says_paid_at: null, source: 'online' };
    (S.tables.ab_appointments = S.tables.ab_appointments || []).push(row); return send(res, 200, row);
  }
  //   POST /__e2e/members {limit?, report?, profile?} -> forces the member limit POST /api/shop/members enforces (null = by plan: Bookings 2, Store 5) and,
  //                                              with report, the number its 409 body carries;
  //                                              profile=false: migration 015 not live (plan capability off, endpoint answers 503)
  if (p === '/__e2e/members') { if ('limit' in body) S.memberLimit = body.limit; if ('report' in body) S.memberReport = body.report; if ('profile' in body) S.memberProfile = !!body.profile; return send(res, 200, { memberLimit: S.memberLimit, memberReport: S.memberReport, memberProfile: S.memberProfile }); }
  if (p === '/__e2e/stripe') { Object.assign(S.stripe, body); return send(res, 200, S.stripe); }
  // ---- fault injection (edge pass): POST /__e2e/fault {path, mode, times?}  path = prefix match; times omitted = until cleared
  //   mode: offline (socket destroyed, request never answered) | hang (never answers; the app's own timeout fires) | 500 | 429 | html500 (gateway HTML page)
  //         | malformed (200 with a body that is not JSON) | lose (request is processed, then the reply is dropped: the 'it worked but the app never heard' case)
  //   POST /__e2e/faults/clear  removes all.   GET /__e2e/faults lists them.
  if (p === '/__e2e/fault') { S.faults.push({ path: body.path, mode: body.mode, times: body.times == null ? -1 : body.times }); return send(res, 200, S.faults); }
  if (p === '/__e2e/faults/clear') { S.faults = []; return send(res, 200, { ok: true }); }
  if (p === '/__e2e/faults') return send(res, 200, S.faults);
  const fault = S.faults.find((x) => p.startsWith(x.path) && x.times !== 0);
  if (fault) {
    if (fault.times > 0) fault.times--;
    const note = `FAULT ${fault.mode} on ${req.method} ${p}`; S.log.push(note); console.log(note);
    switch (fault.mode) {
      case 'offline': req.socket.destroy(); return;
      case 'hang': return;   // leave the request open
      case '500': return send(res, 500, { error: 'e2e-internal' });
      case '429': return send(res, 429, { error: 'Too many requests, slow down.' }, 'application/json', { 'Retry-After': '30' });
      case 'html500': return send(res, 502, '<html><body><h1>502 Bad Gateway</h1></body></html>', 'text/html');
      case 'malformed': return send(res, 200, '{"siteId": "abc", "deployedUr', 'application/json');
      case 'lose': res.write = () => true; res.end = () => { req.socket.destroy(); }; res.writeHead = () => res; break;   // handler runs, reply never leaves
    }
  }
  const f = S.fails.find((x) => x.path === p && x.times > 0);
  if (f) { f.times--; return send(res, f.status, { error: f.error }); }

  if (req.method === 'OPTIONS') return send(res, 204, '');
  // images + uploads
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
      shop = { id: uuid(), owner_id: u.id, slug: slugOf(body.name), name: body.name, timezone: body.timezone, address: body.address || null, phone: body.phone || null, ios_otid: body.transactionId || null, site_base_url: S.siteBase || null, ...DEFAULTS.ab_shops(), created_at: new Date().toISOString() };
      shops.push(shop);
      (S.tables.ab_members = S.tables.ab_members || []).push({ id: uuid(), shop_id: shop.id, role: 'owner', display_name: 'Jack', sort: 0, ...DEFAULTS.ab_members(), role: 'owner' });
      body.services.forEach((s, i) => (S.tables.ab_services = S.tables.ab_services || []).push({ id: uuid(), shop_id: shop.id, name: s.name, price_cents: s.priceCents, duration_min: s.durationMin, description: s.description || null, photo_url: s.photoUrl || null, sort: i, ...DEFAULTS.ab_services() }));
    } else if (body.transactionId) shop.ios_otid = body.transactionId;
    return send(res, 200, { shop: { id: shop.id, slug: shop.slug } });
  }
  if (p === '/api/shop/members' && req.method === 'POST') {
    // The server half of P2: owner only, plan-gated, limit 2 (Bookings) / 5 (Store); existing members are never touched.
    const u = bearerUser(req); if (!u) return send(res, 401, { error: 'unauthorized' });
    const shop = (S.tables.ab_shops || []).find((x) => x.owner_id === u.id); if (!shop) return send(res, 404, { error: 'no-shop' });
    const ents = plan().entitlements;
    if (!ents.bookings && !ents.store) return send(res, 403, { error: 'members-need-bookings' });
    if (!S.memberProfile) return send(res, 503, { error: 'members-unavailable' });
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name || name.length > 80) return send(res, 400, { error: 'invalid', field: 'name' });
    if (body.bookingUrl && !/^https?:\/\//i.test(body.bookingUrl)) return send(res, 400, { error: 'invalid', field: 'bookingUrl' });
    const limit = S.memberLimit != null ? S.memberLimit : (ents.store ? 5 : 2);
    const members = (S.tables.ab_members = S.tables.ab_members || []);
    if (members.filter((m) => m.shop_id === shop.id && m.active !== false).length >= limit) return send(res, 409, { error: 'member-limit', limit: S.memberReport != null ? S.memberReport : limit });
    const row = { id: uuid(), shop_id: shop.id, display_name: name, title: body.title || null, photo_url: body.photo || null, bio: body.bio || null, booking_url: body.bookingUrl || null, sort: 10, created_at: new Date().toISOString(), ...DEFAULTS.ab_members(), role: 'barber' };
    members.push(row);
    return send(res, 200, { member: { id: row.id, name, title: row.title, photo: row.photo_url, bio: row.bio, bookingUrl: row.booking_url, role: 'barber', sort: 10, active: true }, limit });
  }
  if (p === '/api/shop/stripe/onboard') return send(res, 200, { url: `${SELF}/stripe-stub` });
  if (p === '/api/shop/stripe/status') return send(res, 200, S.stripe);
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
