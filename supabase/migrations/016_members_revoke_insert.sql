-- Close the direct-insert path around the member limit (AI Barber P2). NOT APPLIED until the
-- new app build (the one that adds barbers through POST /api/shop/members) is INSTALLED.
--
-- ORDER (do not reverse): 1. apply 015  2. deploy the server (api/shop/members.ts)
-- 3. ship the app build that uses the endpoint and wait until it is installed
-- 4. only then apply this file. Builds already on phones insert into ab_members directly
-- (src/lib/shop.ts addMember); applying this early makes "Add a barber" fail for them.
--
-- Safe on live data: privileges only, no rows touched. Existing members stay active and
-- bookable. The server (service_role) is unaffected and still inserts the owner row at setup.
-- Idempotent: revoking an already-revoked privilege is a no-op.
-- Precondition: 015 must be applied, or owners would have no way to add a barber at all.
do $$ begin
  if to_regprocedure('public.ab_add_member(uuid,uuid,int,text,text,text,text,text)') is null then
    raise exception '016 needs 015 (ab_add_member) applied first';
  end if;
end $$;

revoke insert on public.ab_members from authenticated;

-- Re-state what owners still need (select/update/delete through ab_members_owner_all, 005).
grant select, update, delete on public.ab_members to authenticated;
