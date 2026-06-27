import crypto from 'crypto';
import { buildUserData } from './_buildUserData.js';
import { splitName } from './_hashPii.js';
import { getPlanContentMeta } from '../lib/pixelMeta.js';
import { pushOrderToTripleWhale } from './_twOrder.js';

// Stripe webhook -> Meta CAPI Purchase. The browser pixel + client CAPI
// only fire if the customer returns to ?stripe_session=...; closed tabs,
// failed redirects, and embedded-checkout completions were never reported
// to Meta — so only some real sales showed up. Stripe POSTs this for
// EVERY paid checkout, so Meta always gets the Purchase. We use the raw
// Stripe session id as event_id — the SAME value the browser pixel uses
// (App.tsx reads it from the `stripe_session` param) — so Meta dedupes:
// customers who DO return still count exactly once.

const APP_NAME = 'aibarber';

// Stripe signature verification needs the raw, unparsed request body.
export const config = { api: { bodyParser: false } };

function readRawBody(req: any): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(Buffer.from(c)));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// Verify Stripe's `Stripe-Signature` header without the SDK. Scheme:
// header is `t=<ts>,v1=<sig>[,v1=<sig>]`; signed_payload = `${t}.${body}`;
// expected = HMAC-SHA256(signed_payload, secret) hex. Reject if no v1
// matches or the timestamp is older than the tolerance (replay guard).
function verifyStripeSignature(rawBody: Buffer, sigHeader: string, secret: string, toleranceSec = 300): boolean {
  if (!sigHeader) return false;
  const parts = sigHeader.split(',').map((p) => p.split('='));
  const t = parts.find((p) => p[0] === 't')?.[1];
  const v1s = parts.filter((p) => p[0] === 'v1').map((p) => p[1]);
  if (!t || v1s.length === 0) return false;

  const ts = parseInt(t, 10);
  if (!Number.isFinite(ts) || Math.abs(Math.floor(Date.now() / 1000) - ts) > toleranceSec) return false;

  const signedPayload = `${t}.${rawBody.toString('utf8')}`;
  const expected = crypto.createHmac('sha256', secret).update(signedPayload, 'utf8').digest('hex');
  const expectedBuf = Buffer.from(expected);
  return v1s.some((v1) => {
    const vBuf = Buffer.from(v1);
    return vBuf.length === expectedBuf.length && crypto.timingSafeEqual(vBuf, expectedBuf);
  });
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error('[Stripe Webhook] Missing STRIPE_WEBHOOK_SECRET env var');
    return res.status(500).json({ error: 'Server misconfiguration' });
  }

  // 1. Read + verify the raw body against the signature.
  let event: any;
  try {
    const raw = await readRawBody(req);
    const sig = req.headers['stripe-signature'] as string;
    if (!verifyStripeSignature(raw, sig, webhookSecret)) {
      console.error('[Stripe Webhook] Signature verification failed');
      return res.status(400).json({ error: 'Invalid signature' });
    }
    event = JSON.parse(raw.toString('utf8'));
  } catch (err: any) {
    console.error('[Stripe Webhook] Body/parse error:', err.message);
    return res.status(400).json({ error: 'Bad request' });
  }

  // 2. Only paid checkout completions matter.
  if (event.type !== 'checkout.session.completed') {
    return res.status(200).json({ received: true, ignored: event.type });
  }
  const session = event.data?.object || {};

  // Same-Stripe-account safety: ignore a session explicitly tagged for a
  // different app (untagged sessions still fire — covers separate accounts
  // + any in-flight session created before the tag shipped).
  const sessApp = session.metadata?.app;
  if (sessApp && sessApp !== APP_NAME) {
    return res.status(200).json({ received: true, ignored: `app:${sessApp}` });
  }
  if (session.payment_status !== 'paid') {
    return res.status(200).json({ received: true, ignored: 'unpaid' });
  }

  const accessToken = process.env.FB_ACCESS_TOKEN;
  const pixelId = process.env.FB_PIXEL_ID;
  if (!accessToken || !pixelId) {
    console.error('[Stripe Webhook] Missing FB_ACCESS_TOKEN or FB_PIXEL_ID');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  // 3. Build the Purchase — SAME event_id the browser pixel uses (the
  //    raw Stripe session id) so Meta dedupes the two.
  const eventId = session.id as string;
  const value = typeof session.amount_total === 'number' ? session.amount_total / 100 : 0;
  const currency = (session.currency || 'usd').toUpperCase();
  const details = session.customer_details || {};
  const addr = details.address || {};
  const { first, last } = splitName(details.name);
  const plan = session.metadata?.plan || 'monthly';
  const meta = getPlanContentMeta(plan, value);

  const userData = buildUserData({
    email: details.email || null,
    phone: details.phone || null,
    firstName: first,
    lastName: last,
    city: addr.city || null,
    state: addr.state || null,
    zip: addr.postal_code || null,
    country: addr.country || null,
    externalId: eventId,
    clientIp: null,
    clientUserAgent: null,
  });

  const payload = {
    data: [
      {
        event_name: 'Purchase',
        event_time: Math.floor(Date.now() / 1000),
        event_id: eventId,
        action_source: 'website',
        event_source_url: 'https://www.aibarber.org/',
        user_data: userData,
        custom_data: {
          value,
          currency,
          content_ids: [meta.content_id],
          content_type: meta.content_type,
          content_name: meta.content_name,
          contents: meta.contents,
        },
      },
    ],
    access_token: accessToken,
  };

  try {
    const fbResponse = await fetch(`https://graph.facebook.com/v21.0/${pixelId}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const fbResult = await fbResponse.json();
    if (!fbResponse.ok) {
      console.error('[Stripe Webhook] Meta CAPI error:', fbResult);
      // 500 → Stripe retries; dedup keeps it single once it recovers.
      return res.status(500).json({ error: fbResult.error?.message || 'FB API error' });
    }
    console.log(`[Stripe Webhook] Purchase → Meta ok. event_id=${eventId} value=${value} ${currency} plan=${plan}`);

    // Push the order to Triple Whale (source-of-truth revenue; joins the
    // client-side TriplePixel Purchase on order_id == Stripe session id).
    // No-op until TW_API_KEY is set, so this is safe to ship ahead of the
    // key. A transient (5xx/network) failure returns 500 so Stripe retries
    // — re-sending the same order_id is an idempotent upsert on TW's side.
    // A 4xx is logged but NOT retried (would loop forever) and does not
    // block the already-succeeded Meta report.
    const tw = await pushOrderToTripleWhale(session);
    if (!tw.ok && !tw.skipped) {
      console.error(`[Stripe Webhook] Triple Whale order push failed (retryable=${tw.retryable}):`, tw.error);
      if (tw.retryable) return res.status(500).json({ error: 'TW order push failed (retryable)' });
    } else if (tw.ok) {
      console.log(`[Stripe Webhook] Order → Triple Whale ok. order_id=${eventId}`);
    }
    return res.status(200).json({ received: true, result: fbResult, tw: tw.ok ? 'ok' : tw.skipped ? 'skipped' : 'error' });
  } catch (error: any) {
    console.error('[Stripe Webhook] Meta CAPI failed:', error.message);
    return res.status(500).json({ error: error.message || 'Internal error' });
  }
}
