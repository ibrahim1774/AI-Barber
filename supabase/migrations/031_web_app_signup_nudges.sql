-- 031: do not apply until the owner says so. The reminder sweep is a no-op (skipped: no_table) while these tables are missing.
-- Unpaid sign-up reminder emails (1 h / 24 h / 72 h) and the email suppression list.
-- Additive, web-only. Service role only (RLS on, no policies, anon/authenticated revoked), like 020-026.
-- Creates two new tables and touches nothing else (no auth, sites, ios_purchases, booking or existing web_app tables).
begin;

create table if not exists public.web_app_signup_nudges (
  user_id          uuid not null references auth.users(id) on delete cascade,
  environment      text not null check (environment in ('live','test')),
  signup_at        timestamptz not null,
  email            text,
  step1_sent_at    timestamptz, step1_resend_id text,
  step2_sent_at    timestamptz, step2_resend_id text,
  step3_sent_at    timestamptz, step3_resend_id text,
  claimed_step     smallint check (claimed_step between 1 and 3),
  claimed_at       timestamptz,
  links_used       jsonb not null default '{}'::jsonb,
  stopped_at       timestamptz,
  stop_reason      text check (stop_reason in ('paid','deleted','suppressed','not_web','live','expired','done','before_launch','bad_address')),
  last_checked_at  timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  primary key (user_id, environment)
);
create index if not exists web_app_signup_nudges_due_idx on public.web_app_signup_nudges (environment, stopped_at, last_checked_at);
alter table public.web_app_signup_nudges enable row level security;
revoke all on public.web_app_signup_nudges from anon, authenticated;
grant all on public.web_app_signup_nudges to service_role;

create table if not exists public.web_app_email_suppressions (
  email       text primary key,            -- lowercased
  reason      text not null check (reason in ('unsubscribe','bounce','complaint')),
  source      text,                        -- 'one-click' | 'page' | 'resend:email.bounced' | ...
  user_id     uuid,
  created_at  timestamptz not null default now()
);
alter table public.web_app_email_suppressions enable row level security;
revoke all on public.web_app_email_suppressions from anon, authenticated;
grant all on public.web_app_email_suppressions to service_role;

commit;
