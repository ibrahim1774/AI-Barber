begin;
-- The CHECK validates existing rows under ACCESS EXCLUSIVE: do not queue behind a long transaction and stall live readers.
set local lock_timeout = '5s';
-- Additive. NOT applied by the build agent: apply and test before the redirects (Phase 1 step 5) can take effect.
-- Until it is applied the publish flow cannot read the column, ships no redirects and logs it; nothing else changes.
-- Shape: {"v":1,"paths":["/","/services/","/services/skin-fade/"],"redirects":[{"from":"/services/fade/","to":"/services/skin-fade/"}]}
-- Written only by the server (service role) after a web deploy of a web-created pages-v2 site; null for every other site.
alter table public.web_app_sites add column if not exists published_paths jsonb
  check (published_paths is null or (jsonb_typeof(published_paths) = 'object' and published_paths->>'v' = '1'));
commit;
