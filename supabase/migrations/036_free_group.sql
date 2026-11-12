-- 036: do not apply until the owner says so.
-- Free site portal (primebarber.org/free-site): allow the 'free' price group. Free accounts have NO web_app_entitlements row;
-- the group row is the only record (see lib/webApp/priceGroup.ts). Additive: only the check constraint is replaced.
-- APPLY BEFORE DEPLOYING the server that can store 'free' (until then assignGroup's insert of 'free' would fail).
begin;
set local lock_timeout = '3s';

alter table public.web_app_price_groups drop constraint if exists web_app_price_groups_price_group_check;
alter table public.web_app_price_groups
  add constraint web_app_price_groups_price_group_check check (price_group in ('base', 'g10', 'g20', 'free'));

-- Free accounts are never sent the paywall nudge emails: the sweeper stops them with reason 'free'.
alter table public.web_app_signup_nudges drop constraint if exists web_app_signup_nudges_stop_reason_check;
alter table public.web_app_signup_nudges add constraint web_app_signup_nudges_stop_reason_check
  check (stop_reason in ('paid','deleted','suppressed','not_web','live','expired','done','before_launch','bad_address','late','free'));

commit;
