-- One live web-app site per user and Stripe mode: a double first publish can never bind two slugs to one plan.
-- Additive: an index on the (empty or new) web_app_sites table only.
create unique index if not exists web_app_sites_one_per_user_idx
  on public.web_app_sites (user_id, environment) where removed_at is null;
