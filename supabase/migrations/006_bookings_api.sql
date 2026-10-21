-- Bookings API (AI Barber iOS, phase 2): columns the public booking page and the owner
-- endpoints need on top of 005. Additive and idempotent: re-running the file is a no-op.
--
-- Not re-added here (005 already has them): ab_appointments.reminder_sent_at,
-- ab_appointments.amount_refunded_cents, the manage_token / ics_token defaults.

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

-- ---------------------------------------------------------------------------
-- Privileges. Owner writes to ab_shops are granted column by column (see 005). Exactly the
-- four owner-editable columns added here; never a table-level grant (that would re-open
-- slug, owner_id, platform_fee_bps and the Stripe columns), never ios_otid.
-- ---------------------------------------------------------------------------
grant update (address, phone, accent, daily_summary) on public.ab_shops to authenticated;
