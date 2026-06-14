import type { VercelRequest, VercelResponse } from '@vercel/node';
import { hashEmail, hashPhone, hashExternalId } from './_hashPii.js';

// TikTok Events API (v1.3). Fires server-side Lead, Purchase,
// InitiateCheckout, ViewContent, CompleteRegistration events.
// Mirrors the FB CAPI pattern: client-side pixel fires
// `ttq.track('Lead' | 'Purchase' | …, props, {event_id})`, then this
// endpoint fires the same event_id server-side. TikTok dedupes the
// two automatically when the event_id matches.

const PIXEL_ID = 'D81SNARC77UATASKVG10';

type SupportedEvent = 'Lead' | 'Purchase' | 'InitiateCheckout' | 'ViewContent' | 'CompleteRegistration';
const SUPPORTED: SupportedEvent[] = ['Lead', 'Purchase', 'InitiateCheckout', 'ViewContent', 'CompleteRegistration'];

interface Body {
  event: SupportedEvent;
  event_id: string;
  // Optional Unix seconds for backfill flows; defaults to now.
  event_time?: number;
  event_source_url?: string;
  user_agent?: string;
  value?: number;
  currency?: string;
  // Advanced matching — resolves the "Email and phone are missing"
  // critical issue in TikTok Events Manager. Raw values come in here;
  // they're hashed before being sent to TikTok.
  email?: string;
  phone?: string;
  // external_id boosts EMQ in TikTok Events Manager — we hash the
  // Stripe session id (or auth user id) so the matching is
  // deterministic without exposing PII.
  external_id?: string;
  // content_id + contents resolve the "Content ID is missing" issue.
  // Both are propagated to TikTok's required event properties.
  content_id?: string;
  content_name?: string;
  content_type?: string;
  contents?: Array<{ content_id: string; content_name?: string; quantity?: number; price?: number }>;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ACCESS_TOKEN = process.env.TIKTOK_ACCESS_TOKEN;
  if (!ACCESS_TOKEN) {
    console.error('[TikTok CAPI] Missing TIKTOK_ACCESS_TOKEN env var');
    return res.status(500).json({ error: 'Server misconfiguration' });
  }

  const {
    event,
    event_id,
    event_time, // optional Unix seconds for backfill flows; defaults to now
    event_source_url,
    user_agent,
    value,
    currency,
    email,
    phone,
    external_id,
    content_id,
    content_name,
    content_type,
    contents,
  } = (req.body || {}) as Body;

  if (!event_id || !event) return res.status(400).json({ error: 'Missing event or event_id' });
  if (!SUPPORTED.includes(event)) {
    return res.status(400).json({ error: 'Unsupported event type' });
  }

  const client_ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
    || (req.headers['x-real-ip'] as string)
    || req.socket?.remoteAddress
    || '';
  const client_user_agent = user_agent || (req.headers['user-agent'] as string) || '';

  const TEST_EVENT_CODE = process.env.TIKTOK_TEST_EVENT_CODE;

  // Properties: currency/value for monetary events, content_id +
  // contents for every event (TikTok wants content metadata on
  // ViewContent too so it can build product affinity audiences).
  const properties: Record<string, unknown> = {};
  if (event === 'Purchase' || event === 'InitiateCheckout') {
    properties.currency = (currency || 'USD').toUpperCase();
    properties.value = value ?? 9.0;
  }
  if (content_id) {
    properties.content_id = content_id;
    properties.content_type = content_type || 'product';
    if (content_name) properties.content_name = content_name;
    if (Array.isArray(contents) && contents.length > 0) {
      properties.contents = contents;
    } else {
      // Synthesize a single-item contents[] from the scalar fields so
      // TikTok always sees a contents array (Ads Manager prefers it).
      properties.contents = [{
        content_id,
        content_name: content_name || content_id,
        quantity: 1,
        price: typeof value === 'number' ? value : 0,
      }];
    }
  }

  // Advanced matching — TikTok user object. Hashes computed by
  // _hashPii (trim → lowercase → SHA-256 hex). TikTok ignores empty
  // fields, so include only when we actually have a value.
  const userObj: Record<string, string> = { ip: client_ip, user_agent: client_user_agent };
  const emHash = hashEmail(email);
  const phHash = hashPhone(phone);
  const eidHash = hashExternalId(external_id);
  if (emHash) userObj.email = emHash;
  if (phHash) userObj.phone = phHash;
  if (eidHash) userObj.external_id = eidHash;

  const payload = {
    event_source: 'web',
    event_source_id: PIXEL_ID,
    ...(TEST_EVENT_CODE ? { test_event_code: TEST_EVENT_CODE } : {}),
    data: [
      {
        event,
        // Allow callers to backdate event_time for backfill flows.
        event_time: typeof event_time === 'number' && event_time > 0
          ? Math.floor(event_time)
          : Math.floor(Date.now() / 1000),
        event_id,
        user: userObj,
        properties,
        page: { url: event_source_url || '' },
      },
    ],
  };

  console.log(`[TikTok CAPI] Sending ${event}. event_id=${event_id}, content_id=${content_id || '-'}, em=${emHash ? 'yes' : 'no'}, ph=${phHash ? 'yes' : 'no'}`);

  try {
    const response = await fetch('https://business-api.tiktok.com/open_api/v1.3/event/track/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Access-Token': ACCESS_TOKEN },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    if (!response.ok || (result as any).code !== 0) {
      console.error('[TikTok CAPI] Non-success:', result);
      return res.status(500).json({ error: 'TikTok rejected the event', details: result });
    }
    console.log('[TikTok CAPI] Success:', result);
    return res.status(200).json({ success: true, tt_response: result });
  } catch (error: any) {
    console.error('[TikTok CAPI] Error:', error?.message || error);
    return res.status(500).json({ error: 'Failed to send event to TikTok', details: String(error?.message || error) });
  }
}
