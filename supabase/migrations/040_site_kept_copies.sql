-- 040: do not apply until the owner says so. (One-account plan, Wave C, lane C3.)
-- Whole-site copies set aside instead of being overwritten (a phone draft that differs from the account copy, or the account copy before a
-- replace). Kept 90 days, at most 50 per account (the endpoint removes the oldest first; the daily clean-up removes expired rows from the
-- 10-minute lapse cron behind maintenance_runs, migration 041). No read endpoint for barbers in version 1: support reads the table.
-- Additive only: one NEW table. user_id references auth.users on delete cascade (deleting an account leaves no copy behind).
-- Service role only (RLS on, no policies, anon/authenticated revoked), like 037.
-- Code answers 503 from the endpoint and skips the clean-up while this table is missing; nothing else is affected.
begin;
set local lock_timeout = '3s';

create table if not exists public.site_kept_copies (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  environment     text not null,
  slug            text,
  kind            text not null check (kind in ('phone-draft','account-copy-before-replace')),
  site_data       jsonb not null,
  source_version  int,
  digest          text not null,
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null default now() + interval '90 days',
  unique (user_id, digest)
);
create index if not exists site_kept_copies_user_created_idx on public.site_kept_copies (user_id, created_at);
alter table public.site_kept_copies enable row level security;
revoke all on public.site_kept_copies from anon, authenticated;
grant all on public.site_kept_copies to service_role;

commit;
