-- 033: do not apply until the owner says so.
-- "Bookings setup was finished once": a column that is set the first time ab_shops.bookings_enabled becomes true and
-- is never cleared, so a shop that was only paused later still opens the settings hub, not the first-run wizard
-- (any browser or device). Additive: one nullable column, one trigger function, one trigger, a backfill. The client
-- reads it with select('*') and treats a missing column as "not done" (old behaviour) until this is applied.
begin;
set local lock_timeout = '3s';

alter table public.ab_shops add column if not exists bookings_enabled_once_at timestamptz;

create or replace function public.ab_shops_set_enabled_once()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'UPDATE' then
    new.bookings_enabled_once_at := coalesce(new.bookings_enabled_once_at, old.bookings_enabled_once_at); -- never cleared
  end if;
  if new.bookings_enabled is true and new.bookings_enabled_once_at is null then
    new.bookings_enabled_once_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists ab_shops_enabled_once on public.ab_shops;
create trigger ab_shops_enabled_once before insert or update on public.ab_shops
  for each row execute function public.ab_shops_set_enabled_once();

-- Backfill: shops that have bookings on now, or ever took a real (non walk-in) booking.
update public.ab_shops s
   set bookings_enabled_once_at = now()
 where s.bookings_enabled_once_at is null
   and (s.bookings_enabled = true
        or exists (select 1 from public.ab_appointments a where a.shop_id = s.id and a.source <> 'walk_in'));

commit;
