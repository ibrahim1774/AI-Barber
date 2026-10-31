-- Web app failed-payment reminders: when the last "payment failed" email went out for a subscription, so the
-- first notice is sent at once and follow-ups every 2 days. Additive: two nullable/defaulted columns on a table
-- only the web app uses (web_app_entitlements, migration 020).
alter table public.web_app_entitlements add column if not exists dunning_last_sent_at timestamptz;
alter table public.web_app_entitlements add column if not exists dunning_count integer not null default 0;
