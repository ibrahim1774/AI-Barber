-- Web custom domains, manual fulfilment (plan 2026-11-06). NOT APPLIED: needs Ibrahim's go-ahead,
-- and must be applied BEFORE the server that inserts these states is deployed.
--
-- Two new ios_domains states for a Stripe-paid domain that Ibrahim buys and attaches by hand:
--   awaiting_setup  paid; Ibrahim has been emailed to buy the name and attach it to the project.
--                   Machine-inert: no sweep pass selects it (not resumable, owned or attached).
--   manual_live     Ibrahim marked it live (attach, DNS and HTTPS verified, site republished).
--                   Also machine-inert; webhooks keep paid_until / auto_renew / revoked_at current.
-- Both hold the site's slot (one domain per site), so they join the ios_domains_site_key index.
-- Ending a manual domain reuses 'transferred' (transferred_by = 'manual-ended'); refusing one
-- reuses 'failed'. Additive and idempotent: only widens the state check and the partial index.
alter table public.ios_domains drop constraint if exists ios_domains_state_check;
alter table public.ios_domains add constraint ios_domains_state_check check (state in (
  'reserved', 'buying', 'ordered', 'bought', 'attached', 'live', 'detaching', 'unlinking', 'detached', 'failed', 'transferred',
  'awaiting_setup', 'manual_live'
));

drop index if exists public.ios_domains_site_key;
create unique index if not exists ios_domains_site_key on public.ios_domains (site_slug)
  where state in ('reserved', 'buying', 'ordered', 'bought', 'attached', 'live', 'detaching', 'unlinking', 'awaiting_setup', 'manual_live');
