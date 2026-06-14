#!/usr/bin/env node
// Backfill Purchase events to Meta CAPI + TikTok CAPI for paid Stripe
// Checkout Sessions in the last 48 hours.
//
// Why: /api/fb-purchase + /api/tiktok-event were returning 500
// ERR_MODULE_NOT_FOUND for ~24+ hours due to a missing .js extension
// on the _hashPii import (fixed in PR #6). Customers who had ad blockers
// or strict tracking protection lost ALL conversion attribution since
// browser-side fbq/ttq never made it either. This script replays each
// paid Stripe session through the LIVE /api/fb-purchase + /api/tiktok-
// event endpoints with the ORIGINAL Stripe `created` timestamp, so Meta
// + TikTok attribute the conversion against the customer's original ad
// click history (both CAPIs accept event_time up to 7 days in the past).
//
// PRE-REQS:
//   1. PR #6 (broken _hashPii import) is merged to main + deployed
//   2. PR adding `eventTime` / `event_time` params to the two endpoints
//      is also merged + deployed (otherwise the script will fire events
//      stamped with "now" instead of the original Stripe timestamp).
//
// Usage:
//   cd /Users/ibrahim/AI-Barber
//   node --env-file=.env.local scripts/backfill-purchase-pixels.mjs
//
// Env required:
//   STRIPE_LIVE_KEY  (sk_live_…)
//
// Flags:
//   --hours=N        backfill window (default 48)
//   --dry-run        list paid sessions, do NOT send to Meta/TikTok
//   --base=URL       override API base (default https://www.aibarber.org)

const STRIPE_KEY = process.env.STRIPE_LIVE_KEY;
if (!STRIPE_KEY) { console.error('Missing STRIPE_LIVE_KEY'); process.exit(1); }

const args = new Set(process.argv.slice(2));
const hours = Number(([...args].find((a) => a.startsWith('--hours=')) || '--hours=48').split('=')[1]) || 48;
const dryRun = args.has('--dry-run');
const apiBase = (([...args].find((a) => a.startsWith('--base=')) || '--base=https://www.aibarber.org').split('=')[1]).replace(/\/$/, '');
// Comma-separated emails to exclude (case-insensitive). Use for own test purchases.
const skipEmails = new Set(
  (([...args].find((a) => a.startsWith('--skip-emails=')) || '--skip-emails=').split('=')[1] || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
);
if (skipEmails.size) console.log(`[Backfill] Skip emails: ${[...skipEmails].join(', ')}`);

const since = Math.floor(Date.now() / 1000) - hours * 60 * 60;
console.log(`[Backfill] Window: last ${hours}h (since ${new Date(since * 1000).toISOString()})`);
console.log(`[Backfill] Base:   ${apiBase}`);
if (dryRun) console.log('[Backfill] DRY RUN — no events will be sent.\n');

let sessions = [];
let startingAfter = null;
while (true) {
  const url = new URL('https://api.stripe.com/v1/checkout/sessions');
  url.searchParams.set('limit', '100');
  url.searchParams.set('created[gte]', String(since));
  if (startingAfter) url.searchParams.set('starting_after', startingAfter);
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${STRIPE_KEY}` } });
  if (!resp.ok) {
    console.error('Stripe list failed', resp.status, (await resp.text()).slice(0, 300));
    process.exit(1);
  }
  const json = await resp.json();
  sessions.push(...json.data);
  if (!json.has_more) break;
  startingAfter = json.data[json.data.length - 1].id;
}

const paid = sessions
  .filter((s) => s.payment_status === 'paid' && s.amount_total > 0)
  .filter((s) => !skipEmails.has((s.customer_details?.email || '').toLowerCase()))
  .sort((a, b) => a.created - b.created);

console.log(`[Backfill] ${sessions.length} sessions in window, ${paid.length} paid:`);
for (const s of paid) {
  const when = new Date(s.created * 1000).toISOString();
  const amt = (s.amount_total / 100).toFixed(2);
  const plan = s.metadata?.plan || '?';
  const email = s.customer_details?.email || '(no email)';
  console.log(`  ${s.id}  ${when}  $${amt} ${s.currency.toUpperCase()}  ${email}  plan=${plan}`);
}

if (paid.length === 0 || dryRun) {
  console.log(dryRun ? '\nDry run — done.' : '\nNo paid sessions to backfill. Exiting.');
  process.exit(0);
}

console.log('\n[Backfill] Sending each to Meta CAPI + TikTok CAPI…\n');

const PLAN_CONTENT = {
  monthly: { id: 'aibarber-hosting-monthly', name: 'aibarber.org Monthly Website Hosting' },
  yearly: { id: 'aibarber-hosting-yearly', name: 'aibarber.org Yearly Website Hosting' },
  'monthly-booksy': { id: 'aibarber-hosting-monthly-booksy', name: 'aibarber.org Monthly Website Hosting (Booksy)' },
  'yearly-booksy': { id: 'aibarber-hosting-yearly-booksy', name: 'aibarber.org Yearly Website Hosting (Booksy)' },
  'monthly-free': { id: 'aibarber-hosting-monthly-free', name: 'aibarber.org Monthly Website Hosting (Free Barber)' },
  'yearly-free': { id: 'aibarber-hosting-yearly-free', name: 'aibarber.org Yearly Website Hosting (Free Barber)' },
  custom: { id: 'aibarber-custom-design', name: 'aibarber.org Custom Website Design' },
  custom25: { id: 'aibarber-custom-design', name: 'aibarber.org Custom Website Design' },
  'custom-booksy': { id: 'aibarber-custom-design', name: 'aibarber.org Custom Website Design (Booksy)' },
  primebarber: { id: 'aibarber-primebarber-platform', name: 'aibarber.org PrimeBarber Custom Website Platform' },
  'primebarber-site': { id: 'aibarber-primebarber-site', name: 'aibarber.org PrimeBarber Custom Site Only' },
};

let metaOk = 0, metaErr = 0, ttOk = 0, ttErr = 0;

function splitName(full) {
  if (!full || typeof full !== 'string') return { firstName: null, lastName: null };
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: null, lastName: null };
  if (parts.length === 1) return { firstName: parts[0], lastName: null };
  return { firstName: parts.slice(0, -1).join(' '), lastName: parts[parts.length - 1] };
}

for (const s of paid) {
  const eventId = s.id;
  const eventTime = s.created;
  const value = s.amount_total / 100;
  const currency = (s.currency || 'usd').toUpperCase();
  const cd = s.customer_details || {};
  const addr = cd.address || {};
  const email = cd.email || null;
  const phone = cd.phone || null;
  const { firstName, lastName } = splitName(cd.name);
  const plan = s.metadata?.plan || 'monthly';
  const cfg = PLAN_CONTENT[plan] || PLAN_CONTENT.monthly;
  const contents = [{ id: cfg.id, quantity: 1, item_price: value }];

  // ──────── Meta CAPI via live /api/fb-purchase ────────
  try {
    const r = await fetch(`${apiBase}/api/fb-purchase`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventId,
        eventTime, // ← backdate to Stripe payment time
        value,
        currency,
        customerEmail: email,
        customerPhone: phone,
        firstName,
        lastName,
        city: addr.city || null,
        state: addr.state || null,
        zip: addr.postal_code || null,
        country: addr.country || null,
        externalId: eventId, // Stripe session id → hashed by server
        eventSourceUrl: 'https://www.aibarber.org/',
        clientUserAgent: 'AI-Barber Backfill Script/1.0',
        content_id: cfg.id,
        content_name: cfg.name,
        content_type: 'product',
        contents,
      }),
    });
    if (r.ok) {
      console.log(`  ✅ Meta  ${eventId}  $${value} ${currency}`);
      metaOk += 1;
    } else {
      const body = (await r.text()).slice(0, 200);
      console.log(`  ❌ Meta  ${eventId}  status=${r.status} body=${body}`);
      metaErr += 1;
    }
  } catch (err) {
    console.log(`  ❌ Meta  ${eventId}  throw=${err.message}`);
    metaErr += 1;
  }

  // ──────── TikTok CAPI via live /api/tiktok-event ────────
  try {
    const r = await fetch(`${apiBase}/api/tiktok-event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'Purchase',
        event_id: eventId,
        event_time: eventTime, // ← backdate
        event_source_url: 'https://www.aibarber.org/',
        user_agent: 'AI-Barber Backfill Script/1.0',
        value,
        currency,
        email,
        phone,
        external_id: eventId,
        content_id: cfg.id,
        content_name: cfg.name,
        content_type: 'product',
        contents,
      }),
    });
    if (r.ok) {
      console.log(`  ✅ TT    ${eventId}  $${value} ${currency}`);
      ttOk += 1;
    } else {
      const body = (await r.text()).slice(0, 200);
      console.log(`  ❌ TT    ${eventId}  status=${r.status} body=${body}`);
      ttErr += 1;
    }
  } catch (err) {
    console.log(`  ❌ TT    ${eventId}  throw=${err.message}`);
    ttErr += 1;
  }
}

console.log(`\n[Backfill] Done.  Meta: ${metaOk} ok / ${metaErr} err   TikTok: ${ttOk} ok / ${ttErr} err`);
console.log('Give Meta + TikTok ~5 min to ingest, then check Events Manager and Ads Manager for the new attributions.');
