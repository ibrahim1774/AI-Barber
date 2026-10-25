import { DateTime } from 'luxon';
import type { SupabaseClient } from '@supabase/supabase-js';
import { sendEmail as liveSendEmail, escapeHtml, type EmailMessage, type EmailResult } from './email.js';
import { pushToUsers, type PushMessage, type PushTokenStore } from './push.js';
import { customerAppointmentIcs } from './ics.js';
import { manageUrl, bookingPageUrl, serviceDb } from './payments.js';

/**
 * Booking notifications: owner pushes (Expo) and customer emails (SMTP).
 *
 * notify(event) loads everything it needs from the appointment id and NEVER throws.
 *
 * Who gets what:
 * - booking_created: push to the shop (online bookings only) + confirmation email with .ics.
 *   A card booking still awaiting payment is skipped; the Stripe webhook sends it on
 *   checkout.session.completed, so an abandoned checkout never gets "you're booked".
 * - booking_cancelled {by}: email to the customer; push to the shop unless the shop did it.
 * - booking_rescheduled {by?}: email (+ updated .ics); push unless the shop did it.
 * - customer_says_paid {method, amountCents?}: push.
 * - reminder: email (the cron uses sendReminder directly so it can tell sent from not sent).
 *
 * Every booking push carries data { kind: 'booking', appointmentId, start } (start = ISO UTC);
 * the daily summary carries { kind: 'booking', date: 'YYYY-MM-DD' } (shop-local).
 */

export type ManualMethod = 'cashapp' | 'venmo' | 'zelle' | 'paypal';

export type NotifyEvent =
  | { kind: 'booking_created'; appointmentId: string }
  | { kind: 'booking_cancelled'; appointmentId: string; by: 'customer' | 'shop'; refundedCents?: number }
  | { kind: 'booking_rescheduled'; appointmentId: string; by?: 'customer' | 'shop' }
  | { kind: 'customer_says_paid'; appointmentId: string; method: ManualMethod; amountCents?: number }
  | { kind: 'reminder'; appointmentId: string };

export interface NotifyAppointment {
  id: string;
  shop_id: string;
  member_id: string;
  start_at: string;
  end_at: string;
  service_name: string;
  price_cents: number | null;
  customer_name: string | null;
  customer_email: string | null;
  status: 'booked' | 'done' | 'no_show' | 'cancelled';
  cancelled_by: 'customer' | 'shop' | null;
  payment_status: string;
  payment_method: string | null;
  amount_paid_cents: number;
  amount_refunded_cents: number;
  manage_token: string;
  source: 'online' | 'walk_in';
  updated_at?: string | null;
}

export interface NotifyShop {
  id: string;
  name: string;
  slug: string | null;
  timezone: string;
  owner_id: string;
  address?: string | null;
  phone?: string | null;
  accent?: string | null;
  /** The shop's own site origin (011): customer links use it when set. */
  site_base_url?: string | null;
}

export interface NotifyContext {
  appt: NotifyAppointment;
  shop: NotifyShop;
  memberName: string | null;
  memberUserId: string | null;
  ownerEmail: string | null;
}

export interface NotifyDeps {
  loadContext(appointmentId: string): Promise<NotifyContext | null>;
  sendEmail(msg: EmailMessage): Promise<EmailResult>;
  push(userIds: string[], msg: Omit<PushMessage, 'to'>): Promise<unknown>;
  now(): number;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

const zoned = (iso: string, tz: string) => {
  const d = DateTime.fromISO(iso, { zone: 'utc' }).setZone(tz);
  return d.isValid ? d : DateTime.fromISO(iso, { zone: 'utc' });
};
/** "Fri 2:00 PM" (push copy). */
export const shortWhen = (iso: string, tz: string) => zoned(iso, tz).toFormat('ccc h:mm a');
/** "Friday, October 24 at 2:00 PM" (email copy). */
export const longWhen = (iso: string, tz: string) => zoned(iso, tz).toFormat("cccc, LLLL d 'at' h:mm a");

export const dollars = (cents: number) =>
  cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;

const METHOD_LABEL: Record<ManualMethod, string> = { cashapp: 'Cash App', venmo: 'Venmo', zelle: 'Zelle', paypal: 'PayPal' };

const customerLabel = (a: NotifyAppointment) => a.customer_name?.trim() || 'Walk-in';
const bookingData = (a: NotifyAppointment) => ({ kind: 'booking', appointmentId: a.id, start: new Date(a.start_at).toISOString() });
const fromName = (shop: NotifyShop) => `${shop.name} via Prime Barber`;

function accent(shop: Pick<NotifyShop, 'accent'>): string {
  return shop.accent && /^#[0-9a-fA-F]{6}$/.test(shop.accent) ? shop.accent : '#111111';
}

export function emailLayout(shop: Pick<NotifyShop, 'name' | 'accent'>, heading: string, rows: [string, string][], paragraphs: string[], button?: { label: string; href: string }): string {
  const c = accent(shop);
  const rowHtml = rows
    .map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#666">${escapeHtml(k)}</td><td style="padding:4px 0;color:#111"><strong>${escapeHtml(v)}</strong></td></tr>`)
    .join('');
  const paras = paragraphs.map((p) => `<p style="margin:12px 0;color:#333;line-height:1.5">${escapeHtml(p)}</p>`).join('');
  const btn = button
    ? `<p style="margin:20px 0"><a href="${escapeHtml(button.href)}" style="display:inline-block;background:${c};color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">${escapeHtml(button.label)}</a></p>`
    : '';
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f6f6f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif">
<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:24px">
<p style="margin:0 0 4px;color:${c};font-weight:700">${escapeHtml(shop.name)}</p>
<h1 style="margin:0 0 16px;font-size:22px;color:#111">${escapeHtml(heading)}</h1>
${rows.length ? `<table style="border-collapse:collapse;font-size:15px">${rowHtml}</table>` : ''}
${paras}${btn}
<p style="margin:24px 0 0;color:#999;font-size:12px">Sent by Prime Barber for ${escapeHtml(shop.name)}. Reply to this email to reach the shop.</p>
</div></body></html>`;
}

function detailRows(ctx: NotifyContext): [string, string][] {
  const { appt, shop } = ctx;
  const rows: [string, string][] = [
    ['When', longWhen(appt.start_at, shop.timezone)],
    ['Service', appt.service_name],
  ];
  if (ctx.memberName) rows.push(['Barber', ctx.memberName]);
  if (shop.address) rows.push(['Where', shop.address]);
  if (appt.price_cents != null) rows.push(['Price', dollars(appt.price_cents)]);
  if (appt.amount_paid_cents > 0) rows.push(['Paid', dollars(appt.amount_paid_cents)]);
  return rows;
}

function icsAttachment(ctx: NotifyContext, now: number, cancelled = false) {
  return {
    filename: 'booking.ics',
    contentType: 'text/calendar; charset=utf-8; method=PUBLISH',
    content: customerAppointmentIcs({
      appointmentId: ctx.appt.id,
      start: ctx.appt.start_at,
      end: ctx.appt.end_at,
      serviceName: ctx.appt.service_name,
      shopName: ctx.shop.name,
      memberName: ctx.memberName,
      address: ctx.shop.address ?? null,
      manageUrl: manageUrl(ctx.appt.manage_token, ctx.shop),
      cancelled,
      updatedAt: ctx.appt.updated_at ?? new Date(now).toISOString(),
      now: new Date(now),
    }),
  };
}

// ---------------------------------------------------------------------------
// Emails
// ---------------------------------------------------------------------------

export function confirmationEmail(ctx: NotifyContext, now: number): EmailMessage {
  const { appt, shop } = ctx;
  const link = manageUrl(appt.manage_token, shop);
  return {
    to: appt.customer_email!,
    fromName: fromName(shop),
    replyTo: ctx.ownerEmail,
    subject: `You're booked at ${shop.name}: ${longWhen(appt.start_at, shop.timezone)}`,
    html: emailLayout(shop, "You're booked", detailRows(ctx), [
      'The calendar file attached adds this to your calendar.',
      'Need to change or cancel? Use the link below.',
    ], { label: 'Manage booking', href: link }),
    text: `You're booked at ${shop.name}.\n${appt.service_name}, ${longWhen(appt.start_at, shop.timezone)}.\nManage or cancel: ${link}`,
    attachments: [icsAttachment(ctx, now)],
  };
}

export function cancellationEmail(ctx: NotifyContext, by: 'customer' | 'shop', refundedCents: number, now: number = Date.now()): EmailMessage {
  const { appt, shop } = ctx;
  const paras = [
    by === 'shop'
      ? `${shop.name} had to cancel your appointment. Sorry about that.`
      : 'Your appointment has been cancelled.',
  ];
  if (refundedCents > 0) paras.push(`A refund of ${dollars(refundedCents)} is on its way to your card. It can take 5–10 business days to show.`);
  const rebook = shop.slug ? { label: 'Book another time', href: bookingPageUrl(shop.slug, shop) } : undefined;
  return {
    to: appt.customer_email!,
    fromName: fromName(shop),
    replyTo: ctx.ownerEmail,
    subject: `Cancelled: ${appt.service_name} at ${shop.name}, ${longWhen(appt.start_at, shop.timezone)}`,
    html: emailLayout(shop, 'Booking cancelled', detailRows(ctx), paras, rebook),
    text: `${paras.join('\n')}\n${appt.service_name}, ${longWhen(appt.start_at, shop.timezone)}.${rebook ? `\nBook again: ${rebook.href}` : ''}`,
    // STATUS:CANCELLED with the same UID removes it from the customer's calendar
    attachments: [icsAttachment(ctx, now, true)],
  };
}

export function rescheduleEmail(ctx: NotifyContext, now: number): EmailMessage {
  const { appt, shop } = ctx;
  const link = manageUrl(appt.manage_token, shop);
  return {
    to: appt.customer_email!,
    fromName: fromName(shop),
    replyTo: ctx.ownerEmail,
    subject: `New time at ${shop.name}: ${longWhen(appt.start_at, shop.timezone)}`,
    html: emailLayout(shop, 'Your booking has moved', detailRows(ctx), [
      'Open the attached calendar file to update your calendar.',
    ], { label: 'Manage booking', href: link }),
    text: `Your booking at ${shop.name} is now ${longWhen(appt.start_at, shop.timezone)} (${appt.service_name}).\nManage or cancel: ${link}`,
    attachments: [icsAttachment(ctx, now)],
  };
}

export function reminderEmail(ctx: NotifyContext): EmailMessage {
  const { appt, shop } = ctx;
  const link = manageUrl(appt.manage_token, shop);
  const when = zoned(appt.start_at, shop.timezone).toFormat("cccc 'at' h:mm a");
  return {
    to: appt.customer_email!,
    fromName: fromName(shop),
    replyTo: ctx.ownerEmail,
    subject: `Reminder: ${appt.service_name} at ${shop.name} on ${when}`,
    html: emailLayout(shop, 'See you soon', detailRows(ctx), [
      "Can't make it? Please cancel or reschedule so someone else can have the time.",
    ], { label: 'Manage booking', href: link }),
    text: `Reminder: ${appt.service_name} at ${shop.name}, ${longWhen(appt.start_at, shop.timezone)}.\nManage or cancel: ${link}`,
  };
}

// ---------------------------------------------------------------------------
// notify
// ---------------------------------------------------------------------------

const pushRecipients = (ctx: NotifyContext) => [ctx.shop.owner_id, ctx.memberUserId].filter(Boolean) as string[];

async function emailCustomer(ctx: NotifyContext, deps: NotifyDeps, build: () => EmailMessage): Promise<EmailResult> {
  if (!ctx.appt.customer_email) return 'skipped';
  return deps.sendEmail(build());
}

export async function notify(event: NotifyEvent, deps?: NotifyDeps): Promise<void> {
  try {
    const d = deps ?? liveNotifyDeps();
    const ctx = await d.loadContext(event.appointmentId);
    if (!ctx) {
      console.warn('[bookings/notify] appointment not found:', event.kind, event.appointmentId);
      return;
    }
    const { appt, shop } = ctx;
    const now = d.now();
    const data = bookingData(appt);
    const jobs: Promise<unknown>[] = [];

    switch (event.kind) {
      case 'booking_created': {
        if (appt.payment_method === 'card' && appt.payment_status === 'awaiting') return; // webhook confirms later
        if (appt.source === 'online') {
          jobs.push(d.push(pushRecipients(ctx), {
            body: `New booking: ${customerLabel(appt)}, ${appt.service_name}, ${shortWhen(appt.start_at, shop.timezone)}`,
            data,
          }));
        }
        jobs.push(emailCustomer(ctx, d, () => confirmationEmail(ctx, now)));
        break;
      }
      case 'booking_cancelled': {
        if (event.by !== 'shop') {
          jobs.push(d.push(pushRecipients(ctx), {
            body: `Cancelled: ${customerLabel(appt)}, ${shortWhen(appt.start_at, shop.timezone)}`,
            data,
          }));
        }
        const refunded = event.refundedCents ?? appt.amount_refunded_cents ?? 0;
        jobs.push(emailCustomer(ctx, d, () => cancellationEmail(ctx, event.by, refunded, now)));
        break;
      }
      case 'booking_rescheduled': {
        if (event.by !== 'shop') {
          jobs.push(d.push(pushRecipients(ctx), {
            body: `Rescheduled: ${customerLabel(appt)} → ${shortWhen(appt.start_at, shop.timezone)}`,
            data,
          }));
        }
        jobs.push(emailCustomer(ctx, d, () => rescheduleEmail(ctx, now)));
        break;
      }
      case 'customer_says_paid': {
        const cents = event.amountCents ?? appt.price_cents;
        const label = METHOD_LABEL[event.method] ?? event.method;
        jobs.push(d.push(pushRecipients(ctx), {
          body: cents != null && cents > 0
            ? `${customerLabel(appt)} says they paid ${dollars(cents)} by ${label}`
            : `${customerLabel(appt)} says they paid by ${label}`,
          data,
        }));
        break;
      }
      case 'reminder': {
        jobs.push(emailCustomer(ctx, d, () => reminderEmail(ctx)));
        break;
      }
      default:
        return;
    }
    const results = await Promise.allSettled(jobs);
    for (const r of results) if (r.status === 'rejected') console.error('[bookings/notify] job failed:', (r.reason as any)?.message || r.reason);
  } catch (e: any) {
    console.error('[bookings/notify] failed:', event?.kind, e?.message || e);
  }
}

// ---------------------------------------------------------------------------
// Cron: reminders (every 15 min) and the 8 AM daily summary (hourly)
// ---------------------------------------------------------------------------

/** Both crons run with maxDuration 300 s. Stop STARTING new work early enough that the slowest
 *  single item (an SMTP send: 10 s connect + 10 s greeting + 20 s socket) still ends ~10 s before
 *  the platform kills the function. */
export const CRON_MAX_DURATION_MS = 300_000;
export const CRON_MARGIN_MS = 10_000;
export const REMINDER_BUDGET_MS = CRON_MAX_DURATION_MS - CRON_MARGIN_MS - 40_000; // 250 s
/** A claim older than this whose reminder was never stamped as sent (run killed mid-send) is
 *  taken over by the next run. */
export const REMINDER_CLAIM_STALE_MIN = 10;

export interface CronOpts {
  /** Stop claiming new items after this many ms of wall time. */
  budgetMs?: number;
  /** Wall clock for the budget (defaults to Date.now; deps.now() stays the logical "now"). */
  clock?: () => number;
}

export interface ReminderDeps extends NotifyDeps {
  /** Ids of booked appointments starting in [from, to) with reminder_sent_at null and an email,
   *  excluding unpaid card holds. */
  dueReminders(fromIso: string, toIso: string): Promise<string[]>;
  /** Take the reminder for this run (an ab_events claim row). True when this run owns it; a claim
   *  older than REMINDER_CLAIM_STALE_MIN that never got marked sent is taken over. */
  claimReminder(id: string, nowIso: string): Promise<boolean>;
  /** Stamp reminder_sent_at (where still null) and drop the claim. */
  markReminderSent(id: string, nowIso: string): Promise<void>;
  /** Drop the claim so the next run retries. */
  releaseReminder(id: string): Promise<void>;
}

export async function runReminders(
  deps: ReminderDeps,
  opts: CronOpts = {},
): Promise<{ due: number; sent: number; failed: number; deferred: number }> {
  const clock = opts.clock ?? Date.now;
  const started = clock();
  const budget = opts.budgetMs ?? REMINDER_BUDGET_MS;
  const now = deps.now();
  const nowIso = new Date(now).toISOString();
  const from = new Date(now + 23 * 3600_000).toISOString();
  const to = new Date(now + 25 * 3600_000).toISOString();
  const ids = await deps.dueReminders(from, to);
  let sent = 0;
  let failed = 0;
  let deferred = 0;
  for (let i = 0; i < ids.length; i++) {
    if (clock() - started > budget) {
      // Out of time: leave the rest unclaimed for the next run (every 15 min, 2 h window).
      deferred = ids.length - i;
      break;
    }
    const id = ids[i];
    if (!(await deps.claimReminder(id, nowIso))) continue; // another run has it
    let result: EmailResult = 'failed';
    try {
      const ctx = await deps.loadContext(id);
      if (ctx && ctx.appt.status === 'booked' && ctx.appt.customer_email) result = await deps.sendEmail(reminderEmail(ctx));
      else result = 'sent'; // nothing to send any more; stamp it so it isn't picked up again
    } catch (e: any) {
      console.error('[bookings/reminders] failed:', id, e?.message || e);
    }
    try {
      if (result === 'sent') {
        await deps.markReminderSent(id, nowIso);
        sent += 1;
      } else {
        failed += 1;
        // Not sent (SMTP down or not configured): drop the claim so a later run inside the window retries.
        await deps.releaseReminder(id);
      }
    } catch (e: any) {
      // The claim stays; it goes stale after REMINDER_CLAIM_STALE_MIN and the next run takes it over.
      console.error('[bookings/reminders] stamp/release failed:', id, e?.message || e);
    }
  }
  return { due: ids.length, sent, failed, deferred };
}

// ---------------------------------------------------------------------------
// Live (Supabase service role) dependencies
// ---------------------------------------------------------------------------

function dbFail(op: string, error: { message?: string } | null): never {
  throw new Error(`bookings/notify ${op} failed: ${error?.message ?? 'unknown'}`);
}

export function pushTokenStore(db: SupabaseClient): PushTokenStore {
  return {
    async tokensFor(userIds) {
      const { data, error } = await db.from('ab_push_tokens').select('expo_token').in('user_id', userIds);
      if (error) dbFail('tokensFor', error);
      return (data ?? []).map((r: any) => r.expo_token as string);
    },
    async deleteTokens(tokens) {
      const { error } = await db.from('ab_push_tokens').delete().in('expo_token', tokens);
      if (error) dbFail('deleteTokens', error);
    },
  };
}

export function liveNotifyDeps(db: SupabaseClient = serviceDb()): NotifyDeps {
  const store = pushTokenStore(db);
  return {
    async loadContext(appointmentId) {
      const { data: appt, error } = await db.from('ab_appointments').select('*').eq('id', appointmentId).maybeSingle();
      if (error) dbFail('loadContext(appt)', error);
      if (!appt) return null;
      const { data: shop, error: e2 } = await db.from('ab_shops').select('*').eq('id', (appt as any).shop_id).maybeSingle();
      if (e2) dbFail('loadContext(shop)', e2);
      if (!shop) return null;
      const { data: member } = await db.from('ab_members').select('display_name, user_id').eq('id', (appt as any).member_id).maybeSingle();
      let ownerEmail: string | null = null;
      try {
        const { data: u } = await db.auth.admin.getUserById((shop as any).owner_id);
        ownerEmail = u?.user?.email ?? null;
      } catch { ownerEmail = null; }
      return {
        appt: appt as NotifyAppointment,
        shop: shop as NotifyShop,
        memberName: (member as any)?.display_name ?? null,
        memberUserId: (member as any)?.user_id ?? null,
        ownerEmail,
      };
    },
    sendEmail: (msg) => liveSendEmail(msg),
    push: (userIds, msg) => pushToUsers(userIds, msg, store),
    now: () => Date.now(),
  };
}

export function liveReminderDeps(db: SupabaseClient = serviceDb()): ReminderDeps {
  return {
    ...liveNotifyDeps(db),
    async dueReminders(fromIso, toIso) {
      const { data, error } = await db.from('ab_appointments').select('id, payment_method, payment_status')
        .eq('status', 'booked').is('reminder_sent_at', null).not('customer_email', 'is', null)
        .gte('start_at', fromIso).lt('start_at', toIso).order('start_at').limit(200);
      if (error) dbFail('dueReminders', error);
      return (data ?? [])
        .filter((r: any) => !(r.payment_method === 'card' && r.payment_status === 'awaiting'))
        .map((r: any) => r.id as string);
    },
    async claimReminder(id, nowIso) {
      const key = `reminder-claim:${id}`;
      const insert = () => db.from('ab_events').insert({ kind: 'reminder_claim', dedupe_key: key, payload: { appointmentId: id, at: nowIso } });
      const { error } = await insert();
      if (!error) return true;
      if ((error as { code?: string }).code !== '23505') dbFail('claimReminder', error);
      // Held by someone. Take it over only if that claim is stale (its run died mid-send).
      const cutoff = new Date(Date.parse(nowIso) - REMINDER_CLAIM_STALE_MIN * 60_000).toISOString();
      const { data: gone, error: e2 } = await db.from('ab_events').delete().eq('dedupe_key', key).lt('created_at', cutoff).select('id');
      if (e2) dbFail('claimReminder(stale)', e2);
      if (!Array.isArray(gone) || gone.length === 0) return false;
      const { error: e3 } = await insert();
      if (!e3) return true;
      if ((e3 as { code?: string }).code === '23505') return false; // another run took it over first
      dbFail('claimReminder(retake)', e3);
    },
    async markReminderSent(id, nowIso) {
      const { error } = await db.from('ab_appointments').update({ reminder_sent_at: nowIso }).eq('id', id).is('reminder_sent_at', null);
      if (error) dbFail('markReminderSent', error);
      const { error: e2 } = await db.from('ab_events').delete().eq('dedupe_key', `reminder-claim:${id}`);
      if (e2) console.warn('[bookings/reminders] claim cleanup failed:', id, e2.message);
    },
    async releaseReminder(id) {
      const { error } = await db.from('ab_events').delete().eq('dedupe_key', `reminder-claim:${id}`);
      if (error) dbFail('releaseReminder', error);
    },
  };
}
