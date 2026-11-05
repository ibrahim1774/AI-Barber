begin;
set local lock_timeout = '5s';
-- Additive, idempotent. NOT applied by the build agent: apply and test it (after 028) before turning SERVICE_COPY_AI on.
-- MANDATORY, not optional (review 6c NIT 5): the store selects the approval column on every read, so with 028 applied and 029 not, every mode
-- (classify included) answers 503. Apply 028 and 029 together. Also set SERVICE_COPY_SIGNING_SECRET (16+ chars, server only) before use:
-- without it the service-text endpoint answers 404 (feature off), nothing can be approved and no model text prints (fail closed). The signature itself
-- needs no column (it is recomputed); it binds account, draft/site, service key, niche, text and issue time (approval.ts).
--
-- 1. approval: the owner-approval state of a finished text row (Mode B "Write it for me").
--      null     a PROPOSAL: stored, shown to the barber, never rendered or indexed
--      'owner'  the barber tapped "Looks right" (authenticated endpoint, api/web-app/service-copy mode 'approve')
--      'auto'   written while the server flag SERVICE_COPY_AUTO_PUBLISH was '1' (honoured only while the flag is still on)
-- 2. Rows whose title_key starts with 'family:' hold a Mode A classifier choice ({"v":1,"family":"<library guide id>"}), never text.
-- 3. review 6b NIT 4: 028 was edited in place after it may have been applied; make sure the user_id foreign key exists either way.
alter table public.ab_service_copy add column if not exists approval text;
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.ab_service_copy'::regclass and contype = 'c' and conname = 'ab_service_copy_approval_check') then
    alter table public.ab_service_copy add constraint ab_service_copy_approval_check check (approval is null or approval in ('owner', 'auto'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.ab_service_copy'::regclass and contype = 'f') then
    alter table public.ab_service_copy add constraint ab_service_copy_user_fk foreign key (user_id) references auth.users(id) on delete cascade;
  end if;
end $$;
commit;
