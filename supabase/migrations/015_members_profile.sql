-- Team profiles (AI Barber P2). NOT APPLIED until Ibrahim says go.
-- Idempotent and safe on live data: adds nullable columns, creates/replaces a function and a
-- trigger, re-states grants. It drops no data and deactivates no member. Existing members
-- stay active whatever their count (a shop already over its limit keeps them all).
--
-- 1. ab_members.title (job title shown on the site) and booking_url (the barber's own booking
--    link). Validation lives in the database because owners also update ab_members directly.
--    `bio` and `photo_url` already exist (005). Constraints on new all-null columns validate
--    instantly. Named, so a re-run never adds a second copy.
alter table public.ab_members add column if not exists title text;
alter table public.ab_members add column if not exists booking_url text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ab_members_title_len' and conrelid = 'public.ab_members'::regclass) then
    alter table public.ab_members add constraint ab_members_title_len
      check (title is null or char_length(title) <= 80);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ab_members_booking_url_http' and conrelid = 'public.ab_members'::regclass) then
    alter table public.ab_members add constraint ab_members_booking_url_http
      check (booking_url is null or (booking_url ~* '^https?://' and char_length(booking_url) <= 2048));
  end if;
end $$;

-- 2. ab_add_member: the ONLY way to add a barber once 016 has revoked direct INSERT.
--    Server only (execute: service_role). It bypasses RLS, so it checks ownership itself:
--    the shop must be owned by p_owner (the user id api/shop/members.ts got from requireOwner;
--    the shop id also comes from there, never from the request body).
--    Race safety: `select ... for update` on the shop row serialises concurrent adds for one
--    shop, so two creates at the limit cannot both pass the count. (Postgres rejects
--    `select count(*) ... for update`, and supabase-js has no transactions, hence the lock on
--    the shop row and a plain count after it.)
--    Errors (SQLSTATE P0001, message): 'member-limit' (active members >= p_limit),
--    'not-owner' (no such shop for p_owner), 'invalid-name', 'invalid-limit'.
create or replace function public.ab_add_member(
  p_shop uuid,
  p_owner uuid,
  p_limit int,
  p_name text,
  p_title text,
  p_photo text,
  p_bio text,
  p_booking_url text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_count int;
  v_sort int;
  v_row public.ab_members;
begin
  if p_limit is null or p_limit < 1 then
    raise exception 'invalid-limit';
  end if;
  if p_name is null or btrim(p_name) = '' or char_length(p_name) > 80 then
    raise exception 'invalid-name';
  end if;

  perform 1 from public.ab_shops where id = p_shop and owner_id = p_owner for update;
  if not found then
    raise exception 'not-owner';
  end if;

  select count(*) into v_count from public.ab_members where shop_id = p_shop and active;
  if v_count >= p_limit then
    raise exception 'member-limit';
  end if;

  select coalesce(max(sort), -1) + 1 into v_sort from public.ab_members where shop_id = p_shop;

  insert into public.ab_members (shop_id, role, display_name, title, photo_url, bio, booking_url, sort)
  values (p_shop, 'barber', btrim(p_name), p_title, p_photo, p_bio, p_booking_url, v_sort)
  returning * into v_row;

  return jsonb_build_object(
    'id', v_row.id, 'shop_id', v_row.shop_id, 'role', v_row.role, 'display_name', v_row.display_name,
    'title', v_row.title, 'photo_url', v_row.photo_url, 'bio', v_row.bio, 'booking_url', v_row.booking_url,
    'sort', v_row.sort, 'active', v_row.active
  );
end;
$$;
revoke all on function public.ab_add_member(uuid, uuid, int, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.ab_add_member(uuid, uuid, int, text, text, text, text, text) to service_role;

-- 3. Re-activation guard. A deactivated member can only come back through the server (service
--    role), which is where the limit is checked. With 016 applied, `authenticated` can no
--    longer INSERT, and this trigger closes the other write path around the limit (flipping
--    active false -> true with a direct UPDATE). Deactivating (true -> false) stays allowed.
--    It is not security definer: current_user is the role the statement runs as
--    (authenticated / anon for app and web clients, service_role or postgres for the server).
create or replace function public.ab_members_guard_reactivate()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.active is not true and new.active is true and current_user in ('authenticated', 'anon') then
    raise exception 'reactivate-forbidden' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.ab_members_guard_reactivate() from public, anon, authenticated;

drop trigger if exists ab_members_guard_reactivate on public.ab_members;
create trigger ab_members_guard_reactivate before update of active on public.ab_members
  for each row execute function public.ab_members_guard_reactivate();

-- 4. Re-state the grants the app relies on (a re-run of 005 revokes and re-grants around
--    here; see 008/009). Owners keep select/update/delete on ab_members through
--    ab_members_owner_all; INSERT is removed separately by 016, after the new app build ships.
grant select, update, delete on public.ab_members to authenticated;
