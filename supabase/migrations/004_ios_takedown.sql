-- iOS lapse takedown: when the App Store subscription behind a published site
-- lapses, the iOS sweep replaces the live site with a placeholder page and
-- stamps this column. Content (pending file, sites row, published_at) is kept,
-- so a resubscribe restores the same site on the same link and clears it.
-- Nullable, no default: existing rows are untouched.
alter table public.ios_purchases add column if not exists taken_down_at timestamptz;

-- When the sweep last asked Apple about this row as a takedown/restore
-- candidate (any outcome). Candidates are taken oldest-checked first, so rows
-- Apple can't resolve, or that stay in billing grace, rotate to the back
-- instead of starving genuinely lapsed rows.
alter table public.ios_purchases add column if not exists lapse_checked_at timestamptz;
