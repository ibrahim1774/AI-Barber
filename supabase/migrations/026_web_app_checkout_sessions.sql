-- 026: the one open Stripe Checkout session per web-app user and Stripe mode, so a new checkout (or paying, or deleting the
-- account) can expire it by id. Needed because a session created without a customer cannot be found by customer, and
-- customer_details is not filled until checkout completes. Additive only (new table, no foreign keys, no change to existing tables).
-- Do not apply until the owner says so. Code fails soft (best effort) while this table is missing.
create table if not exists public.web_app_checkout_sessions (
  user_id           uuid not null,
  environment       text not null check (environment in ('live','test')),
  stripe_session_id text not null,
  created_at        timestamptz not null default now(),
  primary key (user_id, environment)
);
alter table public.web_app_checkout_sessions enable row level security;
revoke all on public.web_app_checkout_sessions from anon, authenticated;
