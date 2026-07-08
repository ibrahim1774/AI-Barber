-- Client Sites portal (aibarber.org/edit) — run once in the Supabase SQL editor.
--
-- Adds the static-site editing layer WITHOUT touching any existing AI-Barber
-- tables/policies: one new table, one new storage bucket, and RLS scoped to
-- them only.
--
-- Model: each row = one Claude-generated static site (20-25 HTML pages)
-- deployed as its own Vercel project under the "Client Sites" team. The
-- editable copy of the site's files lives in the `client-sites` storage
-- bucket under `<slug>/...`. The `owner` auth user is the client who may
-- edit + publish it via /edit.

-- ── Table ────────────────────────────────────────────────────────────────
create table if not exists public.client_sites (
  id uuid primary key default gen_random_uuid(),
  -- URL-safe unique key; also the storage folder name and (by convention)
  -- the Vercel project name, e.g. 'mrperfect-atlanta'.
  slug text not null unique,
  -- Display name shown in the portal header, e.g. "Mr Perfect Atlanta".
  name text not null,
  -- Vercel project (Client Sites team) this site publishes to.
  vercel_project_id text not null,
  vercel_project_name text not null,
  -- Production URL to show after publish (custom domain when one exists).
  live_url text,
  -- The client allowed to edit this site. Null until an account is assigned.
  owner uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.client_sites enable row level security;

-- Clients can see ONLY their own site. (Writes to this table happen via the
-- service role — onboard script / publish endpoint — which bypasses RLS.)
drop policy if exists "client reads own site" on public.client_sites;
create policy "client reads own site"
  on public.client_sites for select
  to authenticated
  using (owner = auth.uid());

-- ── Storage bucket ───────────────────────────────────────────────────────
-- Public read: these files ARE the public website content, and public URLs
-- let the editor iframe load pages/assets directly.
insert into storage.buckets (id, name, public)
values ('client-sites', 'client-sites', true)
on conflict (id) do nothing;

-- Owner may list/read their own site's files through the storage API (the
-- editor uses authed download() so saves are visible immediately, without
-- waiting out the public-URL CDN cache).
drop policy if exists "client reads own site files" on storage.objects;
create policy "client reads own site files"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'client-sites'
    and exists (
      select 1 from public.client_sites cs
      where cs.owner = auth.uid()
        and (storage.foldername(objects.name))[1] = cs.slug
    )
  );

-- Owner may write files ONLY under their own site's folder (<slug>/...).
drop policy if exists "client writes own site files" on storage.objects;
create policy "client writes own site files"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'client-sites'
    and exists (
      select 1 from public.client_sites cs
      where cs.owner = auth.uid()
        and (storage.foldername(objects.name))[1] = cs.slug
    )
  );

drop policy if exists "client updates own site files" on storage.objects;
create policy "client updates own site files"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'client-sites'
    and exists (
      select 1 from public.client_sites cs
      where cs.owner = auth.uid()
        and (storage.foldername(objects.name))[1] = cs.slug
    )
  );

drop policy if exists "client deletes own site files" on storage.objects;
create policy "client deletes own site files"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'client-sites'
    and exists (
      select 1 from public.client_sites cs
      where cs.owner = auth.uid()
        and (storage.foldername(objects.name))[1] = cs.slug
    )
  );
