import { buildUserData, extractClientIp } from './_buildUserData.js';

// Meta CAPI ViewContent event. Fires when a visitor lands on any
// /booksy /free-barber /primebarber /new or the homepage funnel.
// Same event_id pairs the browser fbq('track','ViewContent', ...)
// with this CAPI hit so Meta dedupes them and runs them through the
// same attribution path.
//
// Accepts the full advanced-matching field set so ViewContent EMQ
// tracks Purchase EMQ — fbc/fbp from cookies + external_id are the
// values that actually exist on a first page-view (no email yet).

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
      content_id,
      content_name,
      content_type,
    } = req.body || {};

    const accessToken = process.env.FB_ACCESS_TOKEN;
    const pixelId = process.env.FB_PIXEL_ID;

    if (!accessToken || !pixelId) {
      console.error('[FB CAPI ViewContent] Missing FB_ACCESS_TOKEN or FB_PIXEL_ID');
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

    const customData: Record<string, any> = {};
    if (content_id) {
      customData.content_ids = [content_id];
      customData.content_type = content_type || 'product';
      if (content_name) customData.content_name = content_name;
    }

    const eventData = {
      data: [
        {
          event_name: 'ViewContent',
          event_time: Math.floor(Date.now() / 1000),
          event_id: eventId || `view_${Date.now()}`,
          action_source: 'website',
          event_source_url: eventSourceUrl || 'https://www.aibarber.org/',
          user_data: userData,
          ...(Object.keys(customData).length > 0 ? { custom_data: customData } : {}),
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
      console.error('[FB CAPI ViewContent] Error:', fbResult);
      return res.status(fbResponse.status).json({ error: fbResult.error?.message || 'FB API error' });
    }

    console.log(
      `[FB CAPI ViewContent] sent. event_id=${eventId}, content_id=${content_id || '-'}, ` +
      `fields=${Object.keys(userData).filter((k) => !['client_ip_address', 'client_user_agent'].includes(k)).join(',')}`
    );
    return res.status(200).json({ success: true, result: fbResult });
  } catch (error: any) {
    console.error('[FB CAPI ViewContent] Error:', error);
    return res.status(500).json({ error: error.message || 'Internal error' });
  }
}
