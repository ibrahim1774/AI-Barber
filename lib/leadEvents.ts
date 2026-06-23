// Single source of truth for firing a "lead" across the whole funnel.
//
// A lead should fire ONLY at a real completion point — when the visitor
// submits a booking link OR finishes all three fields (shop name +
// service area + phone) — never per-keystroke, per-step, or on a
// name-only submit. Every funnel calls fireLead() at its completion
// point and this module enforces the dedup rules:
//   - CRM webhook  → once per browser SESSION (sessionStorage)
//   - Meta/TikTok Lead pixel + CAPI → once per 90 days (localStorage),
//     matching Meta's attribution window so ROAS counts 1 lead/person.

import type { ShopInputs } from '../types';
import { captureLead } from '../services/leadCaptureService';
import { getViewContentMeta } from './pixelMeta';
import { readMetaCookies } from '../services/metaMatchParams';

const WEBHOOK_SESSION_KEY = 'aibarber_lead_captured';
const LEAD_DEDUP_KEY = 'aibarber_lead_fired_at';
const LEAD_DEDUP_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

// CRM webhook — once per session so the same visitor filling the form
// twice (or a booking link then the manual fallback) yields one row.
function captureLeadOnce(inputs: ShopInputs): void {
  try {
    if (sessionStorage.getItem(WEBHOOK_SESSION_KEY)) return;
  } catch { /* sessionStorage unavailable — fall through and still fire */ }
  captureLead(inputs).catch((err) => console.error('[Lead Capture] non-blocking:', err));
  try { sessionStorage.setItem(WEBHOOK_SESSION_KEY, '1'); } catch {}
}

function shouldFirePixelLead(): boolean {
  try {
    const raw = localStorage.getItem(LEAD_DEDUP_KEY);
    if (!raw) return true;
    const ts = parseInt(raw, 10);
    if (!Number.isFinite(ts)) return true;
    return (Date.now() - ts) > LEAD_DEDUP_TTL_MS;
  } catch { return true; }
}

function markPixelLeadFired(): void {
  try { localStorage.setItem(LEAD_DEDUP_KEY, String(Date.now())); } catch {}
}

// Fire the Meta + TikTok Lead event (browser pixel + server CAPI share
// one event_id for dedupe). Guarded by the 90-day window.
function firePixelLead(inputs: ShopInputs): void {
  if (typeof window === 'undefined') return;
  if (!shouldFirePixelLead()) {
    console.log('[Lead tracking] Skipping Lead pixel — already fired for this visitor within 90 days.');
    return;
  }
  const leadEventId = `lead_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const leadViewMeta = getViewContentMeta(window.location.pathname);
  const leadEmail = (inputs as any).email || null;
  const leadPhone = inputs.phone || null;
  const { fbc: leadFbc, fbp: leadFbp } = readMetaCookies();

  try {
    window.fbq?.('track', 'Lead', { value: 9.0, currency: 'USD', content_name: 'Barbershop Site Generated', content_ids: [leadViewMeta.content_id], content_type: leadViewMeta.content_type }, { eventID: leadEventId });
  } catch (err) {
    console.warn('[FB Pixel Lead] browser fire failed:', err);
  }
  fetch('/api/fb-lead', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      eventId: leadEventId,
      email: leadEmail,
      phone: leadPhone,
      externalId: leadEventId,
      fbc: leadFbc,
      fbp: leadFbp,
      value: 9.0,
      currency: 'USD',
      contentName: 'Barbershop Site Generated',
      content_id: leadViewMeta.content_id,
      content_name: leadViewMeta.content_name,
      content_type: leadViewMeta.content_type,
      eventSourceUrl: window.location.origin,
      clientUserAgent: navigator.userAgent,
    }),
  }).catch((err) => console.error('[FB CAPI Lead] Error (non-blocking):', err));

  try {
    (window as any).ttq?.track('Lead', { content_name: 'Barbershop Site Generated', content_id: leadViewMeta.content_id, content_type: leadViewMeta.content_type }, { event_id: leadEventId });
  } catch (err) {
    console.warn('[TikTok Pixel Lead] browser fire failed:', err);
  }
  fetch('/api/tiktok-event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      event: 'Lead',
      event_id: leadEventId,
      event_source_url: window.location.origin,
      user_agent: navigator.userAgent,
      email: leadEmail,
      phone: leadPhone,
      content_id: leadViewMeta.content_id,
      content_name: leadViewMeta.content_name,
      content_type: leadViewMeta.content_type,
    }),
  }).catch((err) => console.error('[TikTok CAPI Lead] Error (non-blocking):', err));

  markPixelLeadFired();
}

// Returns true when the inputs represent a real completion — a booking
// link, OR both service area and phone filled. Callers that already know
// they're at a completion point can skip this and call fireLead directly.
export function isLeadComplete(inputs: ShopInputs): boolean {
  const hasLink = !!(inputs.bookingUrl && inputs.bookingUrl.trim());
  const hasFields = !!(inputs.area && inputs.area.trim() && inputs.phone && inputs.phone.trim());
  return hasLink || hasFields;
}

// Fire the lead: CRM webhook (once/session) + Meta/TikTok Lead pixel+CAPI
// (once/90 days). Call this ONLY at a completion point.
export function fireLead(inputs: ShopInputs): void {
  captureLeadOnce(inputs);
  firePixelLead(inputs);
}
