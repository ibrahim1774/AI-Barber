-- 024: web app "paid twice" protection + iOS overlap bookkeeping. Additive only (new table, new nullable columns).
-- Do not apply until the owner says so.
-- DEPLOY GATE: apply this BEFORE turning on ANY web-app flag (WEB_APP_CHECKOUT and WEB_APP_ENTITLEMENTS: delete-account and the
-- lapse cron read these tables/columns). Checkout reads web_app_customers and
-- fails closed (502, no Stripe session) while the table is missing.

-- One Stripe customer per user and Stripe mode for the web app (checkout reuses it before any webhook lands).
create table if not exists public.web_app_customers (
  user_id            uuid not null,
  environment        text not null check (environment in ('live','test')),
  stripe_customer_id text not null,
  created_at         timestamptz not null default now(),
  primary key (user_id, environment)
);
alter table public.web_app_customers enable row level security;
revoke all on public.web_app_customers from anon, authenticated;

-- Duplicate / overlap bookkeeping (claims so each alert or refund happens once).
alter table public.web_app_entitlements add column if not exists dup_of text;
alter table public.web_app_entitlements add column if not exists dup_alerted_at timestamptz;
alter table public.web_app_entitlements add column if not exists dup_refunded_at timestamptz;
alter table public.web_app_entitlements add column if not exists ios_overlap_notified_at timestamptz;
alter table public.web_app_entitlements add column if not exists ios_overlap_checked_at timestamptz;
