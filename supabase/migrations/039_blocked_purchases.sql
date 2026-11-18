-- 039: do not apply until the owner says so. (One-account plan, Wave C, lane C1.)
-- Purchases the server refused to tie to an account (or, in ONE_SITE_GUARD=alert, would have refused), and the two
-- once-only stamps: `alerted_at` (the alert to the owner) and `emailed_at` (the one email to the barber). Each stamp is
-- claimed with a conditional update (where it is still null), so the alert and the email go out once per
-- (purchase, account) pair even when two requests race; a failed send resets the stamp.
-- reason: 'web-account' (the account holds a web address), 'other-apple-id' (its address sits on a different purchase),
-- 'mixed' (it would hold two addresses). A web publish that is refused an address has no purchase: it is recorded with the
-- original_transaction_id 'web-publish:<the address the account already holds>'.
-- Additive only: one NEW table. user_id references auth.users on delete cascade. Service role only (RLS on, no policies).
-- Code behaves as "no ledger" while this table is missing: a refusal still refuses, nothing is emailed, the alert goes to the log.
begin;
set local lock_timeout = '3s';

create table if not exists public.blocked_purchases (
  original_transaction_id  text not null,
  user_id                  uuid not null references auth.users(id) on delete cascade,
  reason                   text not null check (reason in ('web-account','other-apple-id','mixed')),
  first_seen_at            timestamptz not null default now(),
  emailed_at               timestamptz,
  alerted_at               timestamptz,
  primary key (original_transaction_id, user_id)
);
alter table public.blocked_purchases enable row level security;
revoke all on public.blocked_purchases from anon, authenticated;
grant all on public.blocked_purchases to service_role;

commit;
