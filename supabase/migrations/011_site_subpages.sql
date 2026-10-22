-- Site subpages (spec 2026-10-22-site-subpages): /book and /shop served on the barber's own
-- domain. Two server-written columns on ab_shops, set after a site deploy that carries the
-- /book and /shop rewrites (lib/siteSubpages.ts refreshSiteBase):
--   * site_base_url: the shop's public site origin (its verified custom domain, else the
--     deployed *.vercel.app URL). Customer-facing links (Stripe Checkout returns, manage and
--     order links, emails, calendar files) use it; null keeps today's aibarber.org links.
--   * site_look: the site's template, colours and hero photo, for styling the two pages.
--
-- NOT owner-writable: no column grant to authenticated (005 revoked table-level update; owners
-- write only the columns 006/008/009 grant). site_base_url flows into Stripe success URLs and
-- emails, so only the service role may set it.
--
-- Apply BEFORE deploying the server code that reads these columns (the bookings and store repos
-- select ab_shops columns by name).
alter table public.ab_shops add column if not exists site_base_url text;
alter table public.ab_shops add column if not exists site_look jsonb;

do $$ begin
  alter table public.ab_shops add constraint ab_shops_site_base_url_origin
    check (site_base_url is null or (site_base_url ~ '^https://[a-z0-9]([a-z0-9.-]*[a-z0-9])?$' and length(site_base_url) <= 261));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.ab_shops add constraint ab_shops_site_look_object
    check (site_look is null or (jsonb_typeof(site_look) = 'object' and length(site_look::text) <= 4096));
exception when duplicate_object then null; end $$;
