import { buildUserData, extractClientIp } from './_buildUserData.js';

// Server-side companion to `fbq('track', 'Lead')`. Same event_id from
// both ends so Meta dedupes. Carries the full advanced-matching field
// set so the Lead EMQ score matches Purchase / InitiateCheckout.
//
// Always emits `currency` + a default `value` in custom_data — Meta
// flags Lead events without currency under "Send valid currency codes
// for more accurate ROAS" in Events Manager Diagnostics.

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
      eventSourceUrl,
      clientUserAgent,
      email,
      phone,
      firstName,
      lastName,
      city,
      state,
      zip,
      country,
      externalId,
      fbc,
      fbp,
      value,
      currency,
      contentName,
      content_id,
      content_name,
      content_type,
    } = req.body || {};

    const accessToken = process.env.FB_ACCESS_TOKEN;
    const pixelId = process.env.FB_PIXEL_ID;

    if (!accessToken || !pixelId) {
      console.error('[FB CAPI Lead] Missing FB_ACCESS_TOKEN or FB_PIXEL_ID');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    const userData = buildUserData({
      email,
      phone,
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

    // Lead events: ROAS modelling in Events Manager flags missing
    // currency as a high-priority diagnostic. Emit a valid ISO code +
    // a default value (the predicted LTV of a Lead, set to the
    // monthly plan price) so the diagnostic clears.
    const customData: Record<string, any> = {
      currency: (typeof currency === 'string' && currency.trim() ? currency : 'USD').toUpperCase(),
      value: typeof value === 'number' ? value : 9.0,
    };
    if (content_id) {
      customData.content_ids = [content_id];
      customData.content_type = content_type || 'product';
      customData.content_name = content_name || contentName || content_id;
    } else if (contentName) {
      customData.content_name = contentName;
    }

    const eventData = {
      data: [
        {
          event_name: 'Lead',
          event_time: Math.floor(Date.now() / 1000),
          event_id: eventId || `lead_${Date.now()}`,
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
      console.error('[FB CAPI Lead] Error:', fbResult);
      return res.status(fbResponse.status).json({ error: fbResult.error?.message || 'FB API error' });
    }

    console.log(
      `[FB CAPI Lead] sent. event_id=${eventId}, content_id=${content_id || '-'}, ` +
      `fields=${Object.keys(userData).filter((k) => !['client_ip_address', 'client_user_agent'].includes(k)).join(',')}`
    );
    return res.status(200).json({ success: true, result: fbResult });
  } catch (error: any) {
    console.error('[FB CAPI Lead] Error:', error);
    return res.status(500).json({ error: error.message || 'Internal error' });
  }
}
