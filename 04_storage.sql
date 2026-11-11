insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('mandate-files', 'mandate-files', false, 10485760,
        array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do update
  set public = false, file_size_limit = 10485760,
      allowed_mime_types = array['image/jpeg','image/png','image/webp','application/pdf'];

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('branding', 'branding', true, 2097152, array['image/png','image/jpeg','image/webp'])
on conflict (id) do update
  set public = true, file_size_limit = 2097152,
      allowed_mime_types = array['image/png','image/jpeg','image/webp'];

drop policy if exists "mandate_files_read" on storage.objects;
drop policy if exists "mandate_files_insert" on storage.objects;
drop policy if exists "mandate_files_delete" on storage.objects;
drop policy if exists "branding_read" on storage.objects;
drop policy if exists "branding_insert" on storage.objects;
drop policy if exists "branding_update" on storage.objects;
drop policy if exists "branding_delete" on storage.objects;

create policy "mandate_files_read" on storage.objects for select to authenticated
  using (bucket_id = 'mandate-files' and public.can_access_conv(((storage.foldername(name))[1])::uuid));

create policy "mandate_files_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'mandate-files' and public.can_access_conv(((storage.foldername(name))[1])::uuid));

create policy "mandate_files_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'mandate-files' and public.is_mayor());

create policy "branding_read" on storage.objects for select to anon, authenticated
  using (bucket_id = 'branding');
create policy "branding_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'branding' and public.is_mayor());
create policy "branding_update" on storage.objects for update to authenticated
  using (bucket_id = 'branding' and public.is_mayor())
  with check (bucket_id = 'branding' and public.is_mayor());
create policy "branding_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'branding' and public.is_mayor());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('announcements', 'announcements', true, 5242880, array['image/png','image/jpeg','image/webp','image/gif'])
on conflict (id) do update
  set public = true, file_size_limit = 5242880,
      allowed_mime_types = array['image/png','image/jpeg','image/webp','image/gif'];

drop policy if exists "announcements_read" on storage.objects;
drop policy if exists "announcements_insert" on storage.objects;
drop policy if exists "announcements_update" on storage.objects;
drop policy if exists "announcements_delete" on storage.objects;

create policy "announcements_read" on storage.objects for select to anon, authenticated
  using (bucket_id = 'announcements');
create policy "announcements_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'announcements' and public.is_mayor());
create policy "announcements_update" on storage.objects for update to authenticated
  using (bucket_id = 'announcements' and public.is_mayor())
  with check (bucket_id = 'announcements' and public.is_mayor());
create policy "announcements_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'announcements' and public.is_mayor());

do $$
declare t text;
begin
  foreach t in array array['mandate_messages','mandate_files','mandate_reads','notifications','mandates','announcements','mandate_members','mandate_complices','mandate_terrains','mandate_vehicles']
  loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;
