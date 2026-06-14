import { hashEmail, hashPhone } from './_hashPii.js';

// Meta CAPI Purchase event. Mirrors the browser-side fbq('track',
// 'Purchase', ...) with shared event_id so Meta dedupes them.
// Adds advanced matching (em + ph) and content_id metadata to clear
// the "Email and phone are missing" + "Content ID is missing"
// warnings in Meta Events Manager.

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') return res.status(405).end();

  try {
    const {
      eventId,
      eventTime, // optional Unix seconds for backfill flows; defaults to now
      value,
      currency,
      customerEmail,
      customerPhone,
      eventSourceUrl,
      clientUserAgent,
      content_id,
      content_name,
      content_type,
      contents,
    } = req.body || {};

    const accessToken = process.env.FB_ACCESS_TOKEN;
    const pixelId = process.env.FB_PIXEL_ID;

    if (!accessToken || !pixelId) {
      console.error('[FB CAPI] Missing FB_ACCESS_TOKEN or FB_PIXEL_ID');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    const userData: Record<string, any> = {};
    const emHash = hashEmail(customerEmail);
    const phHash = hashPhone(customerPhone);
    if (emHash) userData.em = [emHash];
    if (phHash) userData.ph = [phHash];

    const clientIp = req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || '';
    if (clientIp) {
      userData.client_ip_address = Array.isArray(clientIp) ? clientIp[0] : clientIp.split(',')[0].trim();
    }
    if (clientUserAgent) {
      userData.client_user_agent = clientUserAgent;
    }

    const customData: Record<string, any> = {
      currency: currency || 'USD',
      value: value || 9.0,
    };
    if (content_id) {
      customData.content_ids = [content_id];
      customData.content_type = content_type || 'product';
      if (content_name) customData.content_name = content_name;
      customData.contents = Array.isArray(contents) && contents.length > 0
        ? contents
        : [{ id: content_id, quantity: 1, item_price: typeof value === 'number' ? value : 9 }];
    }

    const eventData = {
      data: [
        {
          event_name: 'Purchase',
          // Allow callers to backdate event_time (e.g. backfill scripts
          // replaying Stripe Checkout Sessions after a CAPI outage).
          // Meta accepts event_time up to 7 days in the past.
          event_time: typeof eventTime === 'number' && eventTime > 0
            ? Math.floor(eventTime)
            : Math.floor(Date.now() / 1000),
          event_id: eventId || `purchase_${Date.now()}`,
          action_source: 'website',
          event_source_url: eventSourceUrl || 'https://www.aibarber.org/',
          user_data: userData,
          custom_data: customData,
        },
      ],
      access_token: accessToken,
    };

    const fbResponse = await fetch(
      `https://graph.facebook.com/v21.0/${pixelId}/events`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(eventData),
      }
    );

    const fbResult = await fbResponse.json();

    if (!fbResponse.ok) {
      console.error('[FB CAPI] Error:', fbResult);
      return res.status(fbResponse.status).json({ error: fbResult.error?.message || 'FB API error' });
    }

    console.log(`[FB CAPI] Purchase sent. event_id=${eventId}, content_id=${content_id || '-'}, em=${emHash ? 'yes' : 'no'}, ph=${phHash ? 'yes' : 'no'}`);
    return res.status(200).json({ success: true, result: fbResult });
  } catch (error: any) {
    console.error('[FB CAPI] Error:', error);
    return res.status(500).json({ error: error.message || 'Internal error' });
  }
}
