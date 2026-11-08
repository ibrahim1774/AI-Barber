-- 032: do not apply until the owner says so.
-- Required mobile number after payment (web app) and the admin Customers lookup.
-- Additive: one new table plus two nullable columns on web_app_sites. Service role only (RLS on, no policies,
-- anon/authenticated revoked), like 020-031. Code reads fail soft while the table is missing.
begin;

create table if not exists public.customer_contacts (
  user_id           uuid primary key references auth.users(id) on delete cascade,
  phone_e164        text not null check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  source            text not null check (source in ('post_pay_web','signup_web','admin','backfill')),
  site_slug         text,
  environment       text check (environment in ('live','test')),
  auth_phone_synced boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists customer_contacts_phone_idx on public.customer_contacts (phone_e164);
alter table public.customer_contacts enable row level security;
revoke all on public.customer_contacts from anon, authenticated;
grant all on public.customer_contacts to service_role;

alter table public.web_app_sites add column if not exists contact_phone text;
alter table public.web_app_sites add column if not exists contact_phone_at timestamptz;

commit;
