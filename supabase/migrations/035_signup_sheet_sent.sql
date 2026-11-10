-- 035: do not apply until the owner says so.
-- Sign-up log to the Google Sheet (Make.com webhook). Additive only: two nullable columns on web_app_signup_nudges.
--   sheet_sent_at    : set once the webhook answered 2xx for this user (never posted again).
--   sheet_claimed_at : claim stamp taken before the POST so overlapping cron runs cannot double post (stale after 30 min).
-- Every sign-up has a row in this table (the nudge cron enrolls all new auth users), so the row is the send ledger.
-- APPLY BEFORE DEPLOYING the nudges cron change: the sweep reads these columns. Where they are missing the sheet step
-- reports no_columns and does nothing (the nudge mails are unaffected).
begin;
set local lock_timeout = '3s';

alter table public.web_app_signup_nudges add column if not exists sheet_sent_at timestamptz;
alter table public.web_app_signup_nudges add column if not exists sheet_claimed_at timestamptz;
create index if not exists web_app_signup_nudges_sheet_idx on public.web_app_signup_nudges (environment, signup_at) where sheet_sent_at is null;

commit;
