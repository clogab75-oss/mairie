create or replace function public.app_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and is_active
$$;

create or replace function public.is_active_user() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and is_active and role is not null)
$$;

create or replace function public.is_mayor() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.app_role() = 'maire', false)
$$;

create or replace function public.is_force() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.app_role() in ('chef_police','policier','chef_gendarmerie','gendarme'), false)
$$;

create or replace function public.is_chef() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.app_role() in ('chef_police','chef_gendarmerie'), false)
$$;

create or replace function public.has_perm(p text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select coalesce((permissions ->> p)::boolean, false)
    from public.profiles
    where id = auth.uid() and is_active and role = 'employe'
  ), false)
$$;

create or replace function public.can_view_mandates() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_mayor() or public.is_force() or public.has_perm('mandates')
$$;

create or replace function public.is_member(m uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_active_user()
     and exists (select 1 from public.mandate_members where mandate_id = m and user_id = auth.uid())
$$;

create or replace function public.can_access_conv(m uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_mayor() or public.is_member(m)
$$;

create or replace function public.can_edit_mandate(m uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_mayor()
      or (public.is_chef() and (
            exists (select 1 from public.mandates where id = m and created_by = auth.uid())
            or public.is_member(m)))
$$;

create or replace function public.can_read_mandate(m uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.can_view_mandates()
      or (public.has_perm('documents')
          and exists (select 1 from public.mandates where id = m and status = 'accepte'))
$$;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, prenom, nom, login_email, is_active)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'prenom',''), 'Inconnu'),
    coalesce(nullif(new.raw_user_meta_data ->> 'nom',''), 'Inconnu'),
    new.email,
    false
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.profiles_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    if (new.role is distinct from old.role
        or new.is_active is distinct from old.is_active
        or new.permissions is distinct from old.permissions
        or new.prenom is distinct from old.prenom
        or new.nom is distinct from old.nom)
       and auth.uid() is not null and not public.is_mayor() then
      raise exception 'Action réservée au maire';
    end if;
    if old.role = 'maire' and (new.role is distinct from 'maire' or not new.is_active) then
      raise exception 'Le compte du maire ne peut pas être rétrogradé ni désactivé';
    end if;
    if new.role = 'maire' and old.role is distinct from 'maire'
       and coalesce(current_setting('app.allow_maire', true), '') <> '1' then
      raise exception 'Il ne peut y avoir qu''un seul maire';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists profiles_guard_trg on public.profiles;
create trigger profiles_guard_trg before update on public.profiles
for each row execute function public.profiles_guard();

create or replace function public.mandates_before_insert() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_year int := extract(year from (now() at time zone 'Europe/Paris'))::int;
  v_seq int;
  v_role text;
  v_name text;
  v_prefix text;
  v_pad int;
begin
  select role, prenom || ' ' || nom into v_role, v_name from public.profiles where id = auth.uid();

  new.service := case v_role
    when 'chef_police' then 'police'
    when 'chef_gendarmerie' then 'gendarmerie'
    else new.service end;
  new.status := 'en_attente';
  new.decided_by := null;
  new.decided_by_name := null;
  new.decided_at := null;
  new.refusal_reason := null;
  new.requester_name := coalesce(v_name, new.requester_name);

  insert into public.mandate_counters (year, last_value) values (v_year, 1)
  on conflict (year) do update set last_value = public.mandate_counters.last_value + 1
  returning last_value into v_seq;

  select coalesce(value #>> '{}', '') into v_prefix from public.settings where key = 'number_prefix';
  select coalesce((value #>> '{}')::int, 4) into v_pad from public.settings where key = 'number_pad';
  new.number := coalesce(v_prefix, '') || v_year::text || '-' || lpad(v_seq::text, coalesce(v_pad, 4), '0');
  return new;
end $$;

drop trigger if exists mandates_before_insert_trg on public.mandates;
create trigger mandates_before_insert_trg before insert on public.mandates
for each row execute function public.mandates_before_insert();

create or replace function public.mandates_before_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.number := old.number;
  new.service := old.service;
  new.created_by := old.created_by;
  new.requester_name := old.requester_name;
  new.created_at := old.created_at;

  if new.status is distinct from old.status
     or new.refusal_reason is distinct from old.refusal_reason
     or new.decided_by is distinct from old.decided_by then
    if auth.uid() is not null and not public.is_mayor() then
      raise exception 'Seul le maire peut accepter ou refuser un mandat';
    end if;
  end if;

  if new.status is distinct from old.status then
    new.decided_by := auth.uid();
    new.decided_by_name := (select prenom || ' ' || nom from public.profiles where id = auth.uid());
    new.decided_at := case when new.status = 'en_attente' then null else now() end;
    if new.status <> 'refuse' then new.refusal_reason := null; end if;
    if new.status = 'en_attente' then
      new.decided_by := null; new.decided_by_name := null;
    end if;
  else
    new.decided_by := old.decided_by;
    new.decided_by_name := old.decided_by_name;
    new.decided_at := old.decided_at;
  end if;
  return new;
end $$;

drop trigger if exists mandates_before_update_trg on public.mandates;
create trigger mandates_before_update_trg before update on public.mandates
for each row execute function public.mandates_before_update();

create or replace function public.members_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_role text; v_active boolean;
begin
  select role, is_active into v_role, v_active from public.profiles where id = new.user_id;
  if v_role is null or not v_active
     or v_role not in ('maire','chef_police','policier','chef_gendarmerie','gendarme') then
    raise exception 'Cet utilisateur ne peut pas être ajouté à un dossier';
  end if;
  new.added_by := coalesce(auth.uid(), new.added_by);
  return new;
end $$;

drop trigger if exists members_before_insert_trg on public.mandate_members;
create trigger members_before_insert_trg before insert on public.mandate_members
for each row execute function public.members_before_insert();

create or replace function public.messages_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.user_id := coalesce(auth.uid(), new.user_id);
  new.author_name := (select prenom || ' ' || nom from public.profiles where id = new.user_id);
  new.body := coalesce(new.body, '');
  return new;
end $$;

drop trigger if exists messages_before_insert_trg on public.mandate_messages;
create trigger messages_before_insert_trg before insert on public.mandate_messages
for each row execute function public.messages_before_insert();

create or replace function public.files_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.uploaded_by := coalesce(auth.uid(), new.uploaded_by);
  new.uploaded_by_name := (select prenom || ' ' || nom from public.profiles where id = new.uploaded_by);
  return new;
end $$;

drop trigger if exists files_before_insert_trg on public.mandate_files;
create trigger files_before_insert_trg before insert on public.mandate_files
for each row execute function public.files_before_insert();

alter table public.roles              enable row level security;
alter table public.profiles           enable row level security;
alter table public.mandates           enable row level security;
alter table public.mandate_complices  enable row level security;
alter table public.mandate_terrains   enable row level security;
alter table public.mandate_vehicles   enable row level security;
alter table public.mandate_members    enable row level security;
alter table public.mandate_messages   enable row level security;
alter table public.mandate_files      enable row level security;
alter table public.mandate_reads      enable row level security;
alter table public.mandate_history    enable row level security;
alter table public.notifications      enable row level security;
alter table public.settings           enable row level security;
alter table public.private_settings   enable row level security;
alter table public.mandate_counters   enable row level security;
alter table public.announcements      enable row level security;

do $$
declare r record;
begin
  for r in select schemaname, tablename, policyname from pg_policies where schemaname = 'public' loop
    execute format('drop policy if exists %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

create policy roles_select on public.roles for select to authenticated using (true);

create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_active_user());

create policy mandates_select on public.mandates for select to authenticated
  using (public.can_read_mandate(id));
create policy mandates_insert on public.mandates for insert to authenticated
  with check (public.is_chef() and created_by = auth.uid());
create policy mandates_update on public.mandates for update to authenticated
  using (public.can_edit_mandate(id)) with check (public.can_edit_mandate(id));
create policy mandates_delete on public.mandates for delete to authenticated
  using (public.is_mayor());

create policy complices_select on public.mandate_complices for select to authenticated using (public.can_read_mandate(mandate_id));
create policy complices_insert on public.mandate_complices for insert to authenticated with check (public.can_edit_mandate(mandate_id));
create policy complices_update on public.mandate_complices for update to authenticated using (public.can_edit_mandate(mandate_id)) with check (public.can_edit_mandate(mandate_id));
create policy complices_delete on public.mandate_complices for delete to authenticated using (public.can_edit_mandate(mandate_id));

create policy terrains_select on public.mandate_terrains for select to authenticated using (public.can_read_mandate(mandate_id));
create policy terrains_insert on public.mandate_terrains for insert to authenticated with check (public.can_edit_mandate(mandate_id));
create policy terrains_update on public.mandate_terrains for update to authenticated using (public.can_edit_mandate(mandate_id)) with check (public.can_edit_mandate(mandate_id));
create policy terrains_delete on public.mandate_terrains for delete to authenticated using (public.can_edit_mandate(mandate_id));

create policy vehicles_select on public.mandate_vehicles for select to authenticated using (public.can_read_mandate(mandate_id));
create policy vehicles_insert on public.mandate_vehicles for insert to authenticated with check (public.can_edit_mandate(mandate_id));
create policy vehicles_update on public.mandate_vehicles for update to authenticated using (public.can_edit_mandate(mandate_id)) with check (public.can_edit_mandate(mandate_id));
create policy vehicles_delete on public.mandate_vehicles for delete to authenticated using (public.can_edit_mandate(mandate_id));

create policy members_select on public.mandate_members for select to authenticated
  using (public.can_view_mandates() or user_id = auth.uid());
create policy members_insert on public.mandate_members for insert to authenticated
  with check (public.can_edit_mandate(mandate_id));
create policy members_delete on public.mandate_members for delete to authenticated
  using (public.can_edit_mandate(mandate_id));

create policy messages_select on public.mandate_messages for select to authenticated
  using (public.can_access_conv(mandate_id));
create policy messages_insert on public.mandate_messages for insert to authenticated
  with check (user_id = auth.uid() and public.can_access_conv(mandate_id));
create policy messages_delete on public.mandate_messages for delete to authenticated
  using (public.is_mayor());

create policy files_select on public.mandate_files for select to authenticated
  using (public.can_access_conv(mandate_id));
create policy files_insert on public.mandate_files for insert to authenticated
  with check (uploaded_by = auth.uid() and public.can_access_conv(mandate_id));
create policy files_delete on public.mandate_files for delete to authenticated
  using (public.is_mayor());

create policy reads_select on public.mandate_reads for select to authenticated
  using (public.can_access_conv(mandate_id));
create policy reads_insert on public.mandate_reads for insert to authenticated
  with check (user_id = auth.uid() and public.can_access_conv(mandate_id));
create policy reads_update on public.mandate_reads for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and public.can_access_conv(mandate_id));

create policy history_select on public.mandate_history for select to authenticated
  using (public.is_mayor() or public.has_perm('history') or (mandate_id is not null and public.is_member(mandate_id)));

create policy notifs_select on public.notifications for select to authenticated using (user_id = auth.uid());
create policy notifs_update on public.notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notifs_delete on public.notifications for delete to authenticated using (user_id = auth.uid());

create policy settings_select on public.settings for select to authenticated using (public.is_active_user());
create policy settings_insert on public.settings for insert to authenticated with check (public.is_mayor());
create policy settings_update on public.settings for update to authenticated using (public.is_mayor()) with check (public.is_mayor());
create policy settings_delete on public.settings for delete to authenticated using (public.is_mayor());

create policy private_settings_all on public.private_settings for all to authenticated
  using (public.is_mayor()) with check (public.is_mayor());

create policy announcements_select on public.announcements for select to anon, authenticated
  using (true);
create policy announcements_insert on public.announcements for insert to authenticated
  with check (public.is_mayor());
create policy announcements_update on public.announcements for update to authenticated
  using (public.is_mayor()) with check (public.is_mayor());
create policy announcements_delete on public.announcements for delete to authenticated
  using (public.is_mayor());

create policy settings_public on public.settings for select to anon
  using (key in ('mairie_name','maire_name','maire_title','logo_path','signature_path'));

revoke all on all tables in schema public from anon;
grant select on public.announcements to anon;
grant select on public.settings to anon;

create or replace function public.search_mandates(
  p_q text default null,
  p_service text default null,
  p_status text default null,
  p_from date default null,
  p_to date default null
) returns setof public.mandates
language sql stable security invoker set search_path = public as $$
  select m.*
  from public.mandates m
  where (p_service is null or p_service = '' or m.service = p_service)
    and (p_status is null or p_status = '' or m.status = p_status)
    and (p_from is null or m.created_at >= p_from::timestamptz)
    and (p_to is null or m.created_at < (p_to + 1)::timestamptz)
    and (
      p_q is null or btrim(p_q) = ''
      or m.number ilike '%' || btrim(p_q) || '%'
      or m.person_first ilike '%' || btrim(p_q) || '%'
      or m.person_last ilike '%' || btrim(p_q) || '%'
      or (m.person_first || ' ' || m.person_last) ilike '%' || btrim(p_q) || '%'
      or (m.person_last || ' ' || m.person_first) ilike '%' || btrim(p_q) || '%'
      or m.service ilike '%' || btrim(p_q) || '%'
      or m.agents_concernes ilike '%' || btrim(p_q) || '%'
      or m.requester_name ilike '%' || btrim(p_q) || '%'
      or exists (select 1 from public.mandate_complices c where c.mandate_id = m.id
                 and (c.prenom ilike '%' || btrim(p_q) || '%' or c.nom ilike '%' || btrim(p_q) || '%'
                      or (c.prenom || ' ' || c.nom) ilike '%' || btrim(p_q) || '%'))
      or exists (select 1 from public.mandate_vehicles v where v.mandate_id = m.id
                 and (replace(upper(coalesce(v.plaque,'')), '-', '') like '%' || replace(upper(btrim(p_q)), '-', '') || '%'
                      or v.marque ilike '%' || btrim(p_q) || '%' or v.modele ilike '%' || btrim(p_q) || '%'))
      or exists (select 1 from public.mandate_terrains t where t.mandate_id = m.id
                 and (t.numero ilike '%' || btrim(p_q) || '%' or t.adresse ilike '%' || btrim(p_q) || '%'))
      or exists (select 1 from public.mandate_members mm join public.profiles p on p.id = mm.user_id
                 where mm.mandate_id = m.id
                   and ((p.prenom || ' ' || p.nom) ilike '%' || btrim(p_q) || '%'
                        or (p.nom || ' ' || p.prenom) ilike '%' || btrim(p_q) || '%'))
    )
  order by m.created_at desc
  limit 300
$$;

create or replace function public.touch_login() returns void
language sql security definer set search_path = public as $$
  update public.profiles set last_login = now() where id = auth.uid();
$$;

create or replace function public.login_domain() returns text
language sql immutable as $$ select 'amboise-rp.fr'::text $$;

create or replace function public.login_slug(t text) returns text
language sql immutable set search_path = public, extensions as $$
  select trim(both '-' from regexp_replace(lower(extensions.unaccent(coalesce(t,''))), '[^a-z0-9]+', '-', 'g'))
$$;

create or replace function public._create_user(
  p_prenom text, p_nom text, p_password text, p_role text, p_permissions jsonb default '{}'::jsonb
) returns uuid
language plpgsql security definer set search_path = public, extensions, auth as $$
declare
  v_id uuid := gen_random_uuid();
  v_email text;
begin
  v_email := public.login_slug(p_prenom) || '.' || public.login_slug(p_nom) || '@' || public.login_domain();
  if v_email like '.%@%' or v_email like '%.@%' then
    raise exception 'Nom ou prénom invalide';
  end if;
  if exists (select 1 from auth.users where email = v_email) then
    raise exception 'Un compte existe déjà pour % %', p_prenom, p_nom;
  end if;

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, reauthentication_token, phone_change, phone_change_token
  ) values (
    '00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', v_email,
    extensions.crypt(p_password, extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('prenom', btrim(p_prenom), 'nom', btrim(p_nom)),
    now(), now(),
    '', '', '', '', '', '', '', ''
  );

  insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (v_id::text, v_id,
          jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true, 'phone_verified', false),
          'email', now(), now(), now());

  if p_role = 'maire' then perform set_config('app.allow_maire', '1', true); end if;

  update public.profiles
     set role = p_role, is_active = true, permissions = coalesce(p_permissions, '{}'::jsonb),
         created_by = auth.uid()
   where id = v_id;

  return v_id;
end $$;

revoke all on function public._create_user(text,text,text,text,jsonb) from public, anon, authenticated;

create or replace function public.admin_create_user(
  p_prenom text, p_nom text, p_password text, p_role text, p_permissions jsonb default '{}'::jsonb
) returns uuid
language plpgsql security definer set search_path = public, extensions, auth as $$
begin
  if not public.is_mayor() then raise exception 'Action réservée au maire'; end if;
  if btrim(coalesce(p_prenom,'')) = '' or btrim(coalesce(p_nom,'')) = '' then raise exception 'Prénom et nom obligatoires'; end if;
  if length(coalesce(p_password,'')) < 6 then raise exception 'Mot de passe : 6 caractères minimum'; end if;
  if p_role not in ('employe','chef_police','policier','chef_gendarmerie','gendarme') then
    raise exception 'Rôle invalide';
  end if;
  return public._create_user(p_prenom, p_nom, p_password, p_role, p_permissions);
end $$;

create or replace function public.admin_update_user(
  p_id uuid, p_prenom text, p_nom text, p_role text, p_permissions jsonb
) returns void
language plpgsql security definer set search_path = public, extensions, auth as $$
declare
  v_old public.profiles;
  v_email text;
begin
  if not public.is_mayor() then raise exception 'Action réservée au maire'; end if;
  select * into v_old from public.profiles where id = p_id;
  if not found then raise exception 'Utilisateur introuvable'; end if;
  if btrim(coalesce(p_prenom,'')) = '' or btrim(coalesce(p_nom,'')) = '' then raise exception 'Prénom et nom obligatoires'; end if;

  if v_old.role = 'maire' then
    p_role := 'maire';
  elsif p_role not in ('employe','chef_police','policier','chef_gendarmerie','gendarme') then
    raise exception 'Rôle invalide';
  end if;

  v_email := public.login_slug(p_prenom) || '.' || public.login_slug(p_nom) || '@' || public.login_domain();
  if exists (select 1 from auth.users where email = v_email and id <> p_id) then
    raise exception 'Un compte existe déjà pour % %', p_prenom, p_nom;
  end if;

  update auth.users
     set email = v_email,
         raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb)
                              || jsonb_build_object('prenom', btrim(p_prenom), 'nom', btrim(p_nom)),
         updated_at = now()
   where id = p_id;
  update auth.identities
     set identity_data = identity_data || jsonb_build_object('email', v_email), updated_at = now()
   where user_id = p_id and provider = 'email';

  update public.profiles
     set prenom = btrim(p_prenom), nom = btrim(p_nom), role = p_role,
         permissions = coalesce(p_permissions, '{}'::jsonb), login_email = v_email
   where id = p_id;
end $$;

create or replace function public.admin_set_active(p_id uuid, p_active boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_mayor() then raise exception 'Action réservée au maire'; end if;
  if p_id = auth.uid() then raise exception 'Vous ne pouvez pas désactiver votre propre compte'; end if;
  update public.profiles set is_active = p_active where id = p_id;
end $$;

create or replace function public.admin_set_password(p_id uuid, p_password text) returns void
language plpgsql security definer set search_path = public, extensions, auth as $$
begin
  if not public.is_mayor() then raise exception 'Action réservée au maire'; end if;
  if length(coalesce(p_password,'')) < 6 then raise exception 'Mot de passe : 6 caractères minimum'; end if;
  update auth.users
     set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')), updated_at = now()
   where id = p_id;
end $$;

create or replace function public.admin_delete_user(p_id uuid) returns void
language plpgsql security definer set search_path = public, auth as $$
begin
  if not public.is_mayor() then raise exception 'Action réservée au maire'; end if;
  if p_id = auth.uid() then raise exception 'Vous ne pouvez pas supprimer votre propre compte'; end if;
  if exists (select 1 from public.profiles where id = p_id and role = 'maire') then
    raise exception 'Le compte du maire ne peut pas être supprimé';
  end if;
  delete from auth.users where id = p_id;
end $$;

revoke all on function public.admin_create_user(text,text,text,text,jsonb) from public, anon;
revoke all on function public.admin_update_user(uuid,text,text,text,jsonb) from public, anon;
revoke all on function public.admin_set_active(uuid,boolean) from public, anon;
revoke all on function public.admin_set_password(uuid,text) from public, anon;
revoke all on function public.admin_delete_user(uuid) from public, anon;
revoke all on function public.touch_login() from public, anon;
revoke all on function public.search_mandates(text,text,text,date,date) from public, anon;
grant execute on function public.admin_create_user(text,text,text,text,jsonb) to authenticated;
grant execute on function public.admin_update_user(uuid,text,text,text,jsonb) to authenticated;
grant execute on function public.admin_set_active(uuid,boolean) to authenticated;
grant execute on function public.admin_set_password(uuid,text) to authenticated;
grant execute on function public.admin_delete_user(uuid) to authenticated;
grant execute on function public.touch_login() to authenticated;
grant execute on function public.search_mandates(text,text,text,date,date) to authenticated;
