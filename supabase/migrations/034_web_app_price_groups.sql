-- 034: do not apply until the owner says so.
-- Price test (Prime Barber /10 and /20). Additive only: one new table, one nullable column.
--   web_app_price_groups: which price group a user was assigned (write-once, server only).
--   web_app_entitlements.price_group: the group of the price a subscription is on (set by the webhook for g10 / g20 only).
-- APPLY BEFORE DEPLOYING the price-group, checkout, portal and me changes: they read the new table. Where it is missing,
-- /price-group answers 502, and checkout / portal / me fail closed (see the code comments) rather than guess a price.
begin;
set local lock_timeout = '3s';

create table if not exists public.web_app_price_groups (
  user_id    uuid primary key,
  price_group text not null check (price_group in ('base', 'g10', 'g20')),
  source     text,
  created_at timestamptz not null default now()
);

alter table public.web_app_price_groups enable row level security;
revoke all on public.web_app_price_groups from anon, authenticated;

alter table public.web_app_entitlements add column if not exists price_group text;

commit;
