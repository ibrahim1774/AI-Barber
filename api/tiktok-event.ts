import type { VercelRequest, VercelResponse } from '@vercel/node';

// TikTok Events API (v1.3). Fires server-side Lead or Purchase events.
// Mirrors the FB CAPI pattern in api/fb-lead.ts + api/fb-purchase.ts:
// client-side pixel fires `ttq.track('Lead' | 'Purchase', ..., {event_id})`,
// then this endpoint fires the same event_id server-side. TikTok dedupes
// the two automatically.

const PIXEL_ID = 'D81SNARC77UATASKVG10';

interface Body {
  event: 'Lead' | 'Purchase';
  event_id: string;
  event_source_url?: string;
  user_agent?: string;
  value?: number;
  currency?: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ACCESS_TOKEN = process.env.TIKTOK_ACCESS_TOKEN;
  if (!ACCESS_TOKEN) {
    console.error('[TikTok CAPI] Missing TIKTOK_ACCESS_TOKEN env var');
    return res.status(500).json({ error: 'Server misconfiguration' });
  }

  const { event, event_id, event_source_url, user_agent, value, currency } = (req.body || {}) as Body;

  if (!event_id || !event) return res.status(400).json({ error: 'Missing event or event_id' });
  if (event !== 'Lead' && event !== 'Purchase') {
    return res.status(400).json({ error: 'Unsupported event type' });
  }

  const client_ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
    || (req.headers['x-real-ip'] as string)
    || req.socket?.remoteAddress
    || '';
  const client_user_agent = user_agent || (req.headers['user-agent'] as string) || '';

  const TEST_EVENT_CODE = process.env.TIKTOK_TEST_EVENT_CODE;
  const properties: Record<string, unknown> = {};
  if (event === 'Purchase') {
    properties.currency = (currency || 'USD').toUpperCase();
    properties.value = value ?? 10.0;
  }

  const payload = {
    event_source: 'web',
    event_source_id: PIXEL_ID,
    ...(TEST_EVENT_CODE ? { test_event_code: TEST_EVENT_CODE } : {}),
    data: [
      {
        event,
        event_time: Math.floor(Date.now() / 1000),
        event_id,
        user: { ip: client_ip, user_agent: client_user_agent },
        properties,
        page: { url: event_source_url || '' },
      },
    ],
  };

  console.log(`[TikTok CAPI] Sending ${event}. event_id=${event_id}, ip=${client_ip}`);

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
