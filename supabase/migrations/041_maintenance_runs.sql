-- 041: do not apply until the owner says so. (One-account plan, Wave C, lane C1; 040 is lane C3's kept copies.)
-- Once-a-day throttle for clean-ups run from the 10-minute lapse cron (/api/web-app/lapse): a clean-up claims its row
-- (update where last_run_at is older than a day) before it runs, so two overlapping cron runs do it once.
-- Additive only: one NEW table, no user data, so no auth.users reference. Service role only (RLS on, no policies).
-- Code skips the clean-ups while this table is missing.
begin;
set local lock_timeout = '3s';

create table if not exists public.maintenance_runs (
  name         text primary key,
  last_run_at  timestamptz not null
);
alter table public.maintenance_runs enable row level security;
revoke all on public.maintenance_runs from anon, authenticated;
grant all on public.maintenance_runs to service_role;

commit;
