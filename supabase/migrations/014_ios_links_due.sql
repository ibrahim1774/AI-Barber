-- e2e M1 (2026-10-22 round 2): a downgrade at renewal (e.g. Store -> Website, DID_RENEW with the
-- lower product) used to leave the Book and Shop buttons live, pointing at paused pages, until the
-- app republished. The App Store notification handler now stamps links_due_at when the purchase's
-- product stops granting bookings or store; the iOS sweep then strips the stored copy's Book/Shop
-- links the new plan doesn't cover, redeploys the site, and clears the stamp (only if it is still
-- the one it handled).
--
-- Server-only: written with the service role; no grant, no policy (ios_purchases has RLS with no
-- client policies). Until this is applied the handler's stamp and the sweep pass log and skip;
-- nothing else depends on it.
alter table public.ios_purchases add column if not exists links_due_at timestamptz;

create index if not exists ios_purchases_links_due_idx
  on public.ios_purchases (links_due_at)
  where links_due_at is not null;
