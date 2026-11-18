-- 038: do not apply until the owner says so. (One-account plan, Wave C, lane C1.)
-- One address (slug) per account per environment. Both publish paths take this row before giving out an address
-- (lib/account/sites.ts), so two first publishes at once give one address, and a web address can never sit next to an
-- Apple one. `holder` says which side owns it: 'web' (web_app_sites) or 'apple' (ios_purchases.site_slug).
-- `published_once` is false while a first publish has not succeeded; an unpublished WEB row is released when the publish job
-- gives up and by the daily clean-up after 24 hours (lib/account/maintenance.ts). Apple rows are never cleaned up (a bound
-- iOS slug is permanent).
-- environment uses the ios_purchases vocabulary ('Production' / 'Sandbox'); web_app_* 'live' maps to Production, 'test' to Sandbox.
-- Additive only: one NEW table, nothing existing is touched. user_id references auth.users on delete cascade. Service role only
-- (RLS on, no policies, anon/authenticated revoked), like 037.
-- Code behaves as "ONE_SITE_GUARD off" while this table is missing.
-- Fill it with scripts/one-account-backfill.ts (idempotent; run it again each time the guard is switched on).
begin;
set local lock_timeout = '3s';

create table if not exists public.account_sites (
  user_id         uuid not null references auth.users(id) on delete cascade,
  environment     text not null check (environment in ('Production','Sandbox')),
  slug            text not null unique,
  holder          text not null check (holder in ('web','apple')),
  published_once  boolean not null default false,
  taken_at        timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  primary key (user_id, environment)
);
alter table public.account_sites enable row level security;
revoke all on public.account_sites from anon, authenticated;
grant all on public.account_sites to service_role;

commit;
