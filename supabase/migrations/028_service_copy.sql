begin;
set local lock_timeout = '5s';
-- Additive. NOT applied by the build agent: apply and test it before turning SERVICE_COPY_AI on.
-- Until it is applied api/web-app/service-copy.ts cannot read or claim a row, answers 503 ai_unavailable and makes NO model call.
--
-- One row per (web account, draft, service title key). It is the generate-once cache AND the idempotency claim:
--   state 'pending'  a model call is in flight; claimed_at is a 90 second lease (a second tap sees it and does not call again)
--   state 'done'     the written text (jsonb, shape lib/render/svcCopy.ts SvcCopyEntry), kept for good
-- Written only by the server (service role). The draft's extraPages.svcCopy stays the copy the site renders from.
create table if not exists public.ab_service_copy (
  user_id uuid not null references auth.users(id) on delete cascade,
  draft_id text not null check (char_length(draft_id) between 1 and 100),
  title_key text not null check (char_length(title_key) between 1 and 100),
  state text not null check (state in ('pending', 'done')),
  claim_token text,
  claimed_at timestamptz not null default now(),
  facts_hash text not null check (char_length(facts_hash) = 64),
  copy jsonb check (copy is null or jsonb_typeof(copy) = 'object'),
  tokens_in int,
  tokens_out int,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  primary key (user_id, draft_id, title_key),
  check ((state = 'done') = (copy is not null))
);
alter table public.ab_service_copy enable row level security;
revoke all on public.ab_service_copy from public, anon, authenticated;
commit;
