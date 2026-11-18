-- 037: do not apply until the owner says so.
-- Emails for iOS customers (welcome, "your website isn't live yet", payment problem / subscription ended).
-- Additive only: two NEW tables, nothing existing is touched. Both user_id columns reference auth.users with
-- on delete cascade, so deleting an account leaves no row behind. Service role only (RLS on, no policies, anon/authenticated revoked), like 031.
-- Code behaves as "switch off" (nothing sent, nothing written) while these tables are missing.
--   ios_account_emails : one row per iOS account, written when /api/ios/signup creates the account (only for a Production
--                        purchase and only while IOS_EMAIL_WELCOME or IOS_EMAIL_NOT_LIVE is "1"). Welcome ledger + the
--                        "not live yet" sweep state (24 h and 72 h mails).
--   ios_billing_emails : one row per (original transaction, kind, billing period), the once-only ledger for the Apple
--                        payment-problem / subscription-ended mails.
-- APPLY BEFORE DEPLOYING the server code that reads them.
begin;
set local lock_timeout = '3s';

create table if not exists public.ios_account_emails (
  user_id                  uuid primary key references auth.users(id) on delete cascade,
  original_transaction_id  text not null,
  signup_at                timestamptz not null,
  welcome_sent_at          timestamptz,
  welcome_resend_id        text,
  step1_sent_at            timestamptz, step1_resend_id text,   -- about 24 h after sign-up
  step2_sent_at            timestamptz, step2_resend_id text,   -- about 72 h after sign-up
  claimed_step             smallint check (claimed_step between 1 and 2),
  claimed_at               timestamptz,
  stopped_at               timestamptz,
  stop_reason              text check (stop_reason in ('live','lapsed','refunded','removed','moved','deleted','suppressed','sandbox','expired','done','late','before_launch')),
  last_checked_at          timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
create index if not exists ios_account_emails_due_idx on public.ios_account_emails (stopped_at, last_checked_at);
alter table public.ios_account_emails enable row level security;
revoke all on public.ios_account_emails from anon, authenticated;
grant all on public.ios_account_emails to service_role;

create table if not exists public.ios_billing_emails (
  original_transaction_id  text not null,
  kind                     text not null check (kind in ('renewal_failed','expired')),
  period_key               text not null,   -- the transaction's expiresDate in ms (the billing period that failed / ended), or 'na'
  user_id                  uuid references auth.users(id) on delete cascade,
  claimed_at               timestamptz not null default now(),
  sent_at                  timestamptz,
  resend_id                text,
  primary key (original_transaction_id, kind, period_key)
);
alter table public.ios_billing_emails enable row level security;
revoke all on public.ios_billing_emails from anon, authenticated;
grant all on public.ios_billing_emails to service_role;

commit;
