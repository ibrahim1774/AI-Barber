-- iOS lapse takedown: when the App Store subscription behind a published site
-- lapses, the iOS sweep replaces the live site with a placeholder page and
-- stamps this column. Content (pending file, sites row, published_at) is kept,
-- so a resubscribe restores the same site on the same link and clears it.
alter table public.ios_purchases add column taken_down_at timestamptz;
