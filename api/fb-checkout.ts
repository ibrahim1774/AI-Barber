import { buildUserData, extractClientIp } from './_buildUserData.js';

// Facebook Conversions API — InitiateCheckout event. Mirrors
// fb-purchase.ts. Browser fires
// `fbq('track','InitiateCheckout',{value,currency},{eventID})` with
// the same event_id so Meta dedupes browser-pixel against CAPI.
//
// Accepts the full advanced-matching field set so the
// InitiateCheckout EMQ score tracks Purchase EMQ.

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
      value,
      currency,
      customerEmail,
      customerPhone,
      firstName,
      lastName,
      city,
      state,
      zip,
      country,
      externalId,
      fbc,
      fbp,
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
      console.error('[FB Checkout CAPI] Missing FB_ACCESS_TOKEN or FB_PIXEL_ID');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    const userData = buildUserData({
      email: customerEmail,
      phone: customerPhone,
      firstName,
      lastName,
      city,
      state,
      zip,
      country,
      externalId: externalId || eventId || null,
      fbc,
      fbp,
      clientIp: extractClientIp(req.headers),
      clientUserAgent: clientUserAgent || req.headers['user-agent'] || '',
    });

    const customData: Record<string, any> = {
      currency: currency || 'USD',
      value: typeof value === 'number' ? value : 10.0,
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
          event_name: 'InitiateCheckout',
          event_time: Math.floor(Date.now() / 1000),
          event_id: eventId || `checkout_${Date.now()}`,
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
      console.error('[FB Checkout CAPI] Error:', fbResult);
      return res.status(fbResponse.status).json({ error: fbResult.error?.message || 'FB API error' });
    }

    console.log(
      `[FB Checkout CAPI] InitiateCheckout sent. event_id=${eventId}, content_id=${content_id || '-'}, ` +
      `fields=${Object.keys(userData).filter((k) => !['client_ip_address', 'client_user_agent'].includes(k)).join(',')}`
    );
    return res.status(200).json({ success: true, result: fbResult });
  } catch (error: any) {
    console.error('[FB Checkout CAPI] Error:', error);
    return res.status(500).json({ error: error.message || 'Internal error' });
  }
}
