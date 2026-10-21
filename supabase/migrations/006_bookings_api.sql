-- Bookings API (AI Barber iOS, phase 2): columns the public booking page and the owner
-- endpoints need on top of 005. Additive and idempotent: re-running the file is a no-op.
--
-- Not re-added here (005 already has them): ab_appointments.reminder_sent_at,
-- ab_appointments.amount_refunded_cents, ab_appointments.cancelled_at, the manage_token /
-- ics_token defaults. ab_appointments.paid_at belongs to S2's 007.

-- ---------------------------------------------------------------------------
-- ab_shops
-- ---------------------------------------------------------------------------
-- ios_otid: the App Store purchase (ios_purchases.original_transaction_id) behind the
-- bookings gate. Server-set only (POST /api/shop/setup verifies it with Apple); never
-- granted to authenticated, and unique so one subscription can't unlock several shops.
alter table public.ab_shops add column if not exists ios_otid text;
alter table public.ab_shops add column if not exists address text;
alter table public.ab_shops add column if not exists phone text;
alter table public.ab_shops add column if not exists accent text;
alter table public.ab_shops add column if not exists daily_summary bool not null default false;

create unique index if not exists ab_shops_ios_otid_key on public.ab_shops (ios_otid)
  where ios_otid is not null;

-- ---------------------------------------------------------------------------
-- ab_appointments
-- ---------------------------------------------------------------------------
-- Set by POST /api/book/sent ("I've sent it" on a manual rail). Informational only.
alter table public.ab_appointments add column if not exists customer_says_paid_at timestamptz;
-- Set by the owner reschedule (POST /api/shop/appointments/:id/reschedule). A customer
-- cancel of a booking the shop moved refunds as if the shop had cancelled (full refund);
-- cancelled_by still records 'customer'.
alter table public.ab_appointments add column if not exists shop_rescheduled_at timestamptz;
-- The cancel refund S1 owes, as an absolute target total (compare with amount_refunded_cents).
-- Written right after the atomic cancel claim, before Stripe is called; while it is above
-- amount_refunded_cents the refund is pending and retryPendingRefunds() retries it.
alter table public.ab_appointments add column if not exists refund_due_cents int not null default 0;
do $$ begin
  alter table public.ab_appointments add constraint ab_appointments_refund_due_nonneg check (refund_due_cents >= 0);
exception when duplicate_object then null; end $$;
-- PostgREST can't compare two columns, so the sweep filters on this generated flag.
alter table public.ab_appointments add column if not exists refund_pending bool
  generated always as (refund_due_cents > amount_refunded_cents) stored;
create index if not exists ab_appointments_refund_pending_idx on public.ab_appointments (updated_at)
  where refund_pending;

-- ---------------------------------------------------------------------------
-- Privileges. Owner writes to ab_shops are granted column by column (see 005). Exactly the
-- four owner-editable columns added here; never a table-level grant (that would re-open
-- slug, owner_id, platform_fee_bps and the Stripe columns), never ios_otid.
-- ---------------------------------------------------------------------------
grant update (address, phone, accent, daily_summary) on public.ab_shops to authenticated;

-- Owners no longer UPDATE ab_appointments directly: status and money changes go through the
-- server (POST /api/shop/appointments/:id/{cancel,reschedule,mark}, the Stripe webhook), so
-- amount_paid_cents, amount_refunded_cents, the Stripe ids and payment_status can't be
-- edited from the app. No column grants are added back. Owners keep SELECT (RLS), and the
-- service role is unaffected.
revoke update on public.ab_appointments from authenticated;

-- ---------------------------------------------------------------------------
-- Rate limits shared by every serverless instance (lib/bookings/rateLimit.ts): per-IP limits
-- on the public writes (10/min) and a per-shop cap on online bookings (40/hour). Fixed
-- windows aligned to the epoch. Only the service role touches this: RLS on with no
-- policies, no table grants, and execute on the function revoked from everyone else.
-- ---------------------------------------------------------------------------
create table if not exists public.ab_rate_hits (
  key text not null,
  window_start timestamptz not null,
  hits int not null default 0,
  primary key (key, window_start)
);
alter table public.ab_rate_hits enable row level security;
revoke all on public.ab_rate_hits from public, anon, authenticated;

-- Count one hit for p_key in the current p_window_s-second window; true while hits <= p_max.
-- Atomic under concurrency (insert ... on conflict do update). About 1% of calls also delete
-- windows older than a day.
create or replace function public.ab_rate_hit(p_key text, p_window_s int, p_max int)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window timestamptz;
  v_hits int;
begin
  if p_key is null or p_window_s is null or p_window_s <= 0 or p_max is null then
    raise exception 'ab_rate_hit: invalid arguments';
  end if;
  v_window := to_timestamp(floor(extract(epoch from now()) / p_window_s) * p_window_s);
  insert into public.ab_rate_hits as h (key, window_start, hits)
    values (p_key, v_window, 1)
    on conflict (key, window_start) do update set hits = h.hits + 1
    returning h.hits into v_hits;
  if random() < 0.01 then
    delete from public.ab_rate_hits where window_start < now() - interval '1 day';
  end if;
  return v_hits <= p_max;
end;
$$;

revoke all on function public.ab_rate_hit(text, int, int) from public, anon, authenticated;
grant execute on function public.ab_rate_hit(text, int, int) to service_role;
