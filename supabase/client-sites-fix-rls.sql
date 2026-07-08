-- FIX: storage policies referenced unqualified `name`, which inside the
-- subquery resolved to client_sites.name (the display name!) instead of the
-- storage object path — so every owner write was rejected (403). Qualify as
-- objects.name. Also adds an explicit with-check to the UPDATE policy.
-- Run in the Supabase SQL editor (replaces the four storage policies).

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

drop policy if exists "client writes own site files" on storage.objects;
create policy "client writes own site files"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'client-sites'
    and position('..' in objects.name) = 0
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
  )
  with check (
    bucket_id = 'client-sites'
    and position('..' in objects.name) = 0
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
