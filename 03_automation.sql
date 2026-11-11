drop function if exists public.discord_send(text, jsonb);
drop function if exists public.discord_embed(text, text, jsonb);
drop function if exists public.admin_test_discord();

create or replace function public.discord_send(p_kind text, p_body jsonb, p_hook text default 'discord_webhook') returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_url text;
  v_enabled boolean;
begin
  select value into v_url from public.private_settings where key = p_hook;
  if v_url is null or btrim(v_url) = '' then return; end if;

  select coalesce((value #>> '{}')::boolean, true) into v_enabled
  from public.settings where key = 'notify_' || p_kind;
  if v_enabled is false then return; end if;

  perform net.http_post(
    url := v_url,
    body := p_body || jsonb_build_object(
      'username', 'Mairie d''Amboise',
      'allowed_mentions', jsonb_build_object('parse', '[]'::jsonb)
    ),
    headers := '{"Content-Type":"application/json"}'::jsonb
  );
exception when others then
  null;
end $$;

create or replace function public.discord_notify(p_kind text, p_content text) returns void
language sql security definer set search_path = public as $$
  select public.discord_send(p_kind, jsonb_build_object('content', left(p_content, 1900)));
$$;

create or replace function public.discord_embed(p_kind text, p_content text, p_embed jsonb, p_hook text default 'discord_webhook') returns void
language sql security definer set search_path = public as $$
  select public.discord_send(p_kind, jsonb_build_object(
    'content', left(coalesce(p_content, ''), 1900),
    'embeds', jsonb_build_array(p_embed)), p_hook);
$$;

revoke all on function public.discord_send(text,jsonb,text) from public, anon, authenticated;
revoke all on function public.discord_notify(text,text) from public, anon, authenticated;
revoke all on function public.discord_embed(text,text,jsonb,text) from public, anon, authenticated;

create or replace function public.admin_test_discord(p_target text default 'notifications') returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not public.is_mayor() then raise exception 'Action réservée au maire'; end if;
  if p_target = 'announcements' then
    perform public.discord_embed('test', '', jsonb_build_object(
      'title', '📢 TEST – ANNONCES CITOYENNES',
      'description', 'Le webhook des annonces fonctionne correctement.',
      'color', 13214247), 'discord_webhook_announcements');
  else
    perform public.discord_notify('test', E'🏛️ **TEST – MAIRIE D''AMBOISE**\n\nLe webhook des notifications fonctionne correctement.');
  end if;
end $$;

revoke all on function public.admin_test_discord(text) from public, anon;
grant execute on function public.admin_test_discord(text) to authenticated;

create or replace function public.log_history(p_mandate uuid, p_msg text) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.mandate_history (mandate_id, mandate_number, actor_id, actor_name, message)
  select m.id, m.number, auth.uid(),
         coalesce((select prenom || ' ' || nom from public.profiles where id = auth.uid()), 'Système'),
         p_msg
  from public.mandates m where m.id = p_mandate;
end $$;

revoke all on function public.log_history(uuid,text) from public, anon, authenticated;

create or replace function public.actor_name() returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select prenom || ' ' || nom from public.profiles where id = auth.uid()), 'Système')
$$;

create or replace function public.service_label(s text) returns text
language sql immutable as $$
  select case s when 'police' then 'Police' when 'gendarmerie' then 'Gendarmerie' else coalesce(s,'') end
$$;

create or replace function public.notify_mayors(p_type text, p_title text, p_body text, p_mandate uuid) returns void
language sql security definer set search_path = public as $$
  insert into public.notifications (user_id, type, title, body, mandate_id)
  select id, p_type, p_title, p_body, p_mandate
  from public.profiles where role = 'maire' and is_active and id is distinct from auth.uid();
$$;

revoke all on function public.notify_mayors(text,text,text,uuid) from public, anon, authenticated;

create or replace function public.mandates_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.log_history(new.id, 'Création du mandat #' || new.number);

  if new.created_by is not null then
    insert into public.mandate_members (mandate_id, user_id, added_by)
    values (new.id, new.created_by, new.created_by)
    on conflict do nothing;
  end if;

  perform public.notify_mayors('mandate_new', 'Nouvelle demande de mandat',
    '#' || new.number || ' – ' || new.person_first || ' ' || new.person_last
      || ' (' || public.service_label(new.service) || ')', new.id);

  perform public.discord_notify('new',
    E'🚨 **NOUVELLE DEMANDE DE MANDAT**\n\n'
    || 'Mandat : #' || new.number || E'\n'
    || 'Personne : ' || new.person_first || ' ' || new.person_last || E'\n'
    || 'Service : ' || public.service_label(new.service) || E'\n'
    || 'Demandeur : ' || coalesce(new.requester_name, '?') || E'\n\n'
    || E'Statut : EN ATTENTE\n\nUne validation du maire est nécessaire.');
  return new;
end $$;

drop trigger if exists mandates_after_insert_trg on public.mandates;
create trigger mandates_after_insert_trg after insert on public.mandates
for each row execute function public.mandates_after_insert();

create or replace function public.mandates_after_update() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_actor text := public.actor_name();
  v_changed boolean;
begin
  if new.status is distinct from old.status then
    if new.status = 'accepte' and old.status <> 'cloture' then
      perform public.log_history(new.id, 'Mandat #' || new.number || ' accepté');
    elsif new.status = 'refuse' then
      perform public.log_history(new.id, 'Mandat #' || new.number || ' refusé'
        || case when coalesce(new.refusal_reason,'') <> '' then ' – motif : ' || new.refusal_reason else '' end);
    elsif new.status = 'cloture' then
      perform public.log_history(new.id, 'Mandat #' || new.number || ' clôturé'
        || case when coalesce(new.closure_summary,'') <> '' then ' – bilan : ' || new.closure_summary else '' end);
    elsif old.status = 'cloture' then
      perform public.log_history(new.id, 'Mandat #' || new.number || ' rouvert');
    else
      perform public.log_history(new.id, 'Mandat #' || new.number || ' remis en attente');
    end if;

    if new.status = 'cloture' then
      insert into public.notifications (user_id, type, title, body, mandate_id)
      select distinct u.uid, 'mandate_closed', 'Mandat clôturé',
             '#' || new.number || ' – ' || new.person_first || ' ' || new.person_last, new.id
      from (
        select new.created_by as uid
        union select user_id from public.mandate_members where mandate_id = new.id
        union select id from public.profiles where role = 'maire' and is_active
      ) u
      where u.uid is not null and u.uid is distinct from auth.uid();

      perform public.discord_notify('decision',
        E'🔒 **MANDAT CLÔTURÉ**\n\n'
        || 'Mandat : #' || new.number || E'\n'
        || 'Personne : ' || new.person_first || ' ' || new.person_last || E'\n'
        || 'Clôturé par : ' || v_actor || E'\n\nBilan :\n'
        || coalesce(nullif(new.closure_summary, ''), 'Non précisé'));
    end if;

    if new.status in ('accepte','refuse') and old.status <> 'cloture' then
      insert into public.notifications (user_id, type, title, body, mandate_id)
      select distinct u.uid,
             case when new.status = 'accepte' then 'mandate_accepted' else 'mandate_refused' end,
             case when new.status = 'accepte' then 'Mandat accepté' else 'Mandat refusé' end,
             '#' || new.number || ' – ' || new.person_first || ' ' || new.person_last,
             new.id
      from (
        select new.created_by as uid
        union
        select user_id from public.mandate_members where mandate_id = new.id
      ) u
      where u.uid is not null and u.uid is distinct from auth.uid();

      if new.status = 'accepte' then
        perform public.discord_notify('decision',
          E'✅ **MANDAT ACCEPTÉ**\n\n'
          || 'Mandat : #' || new.number || E'\n'
          || 'Personne : ' || new.person_first || ' ' || new.person_last || E'\n'
          || 'Validé par : ' || v_actor);
      else
        perform public.discord_notify('decision',
          E'❌ **MANDAT REFUSÉ**\n\n'
          || 'Mandat : #' || new.number || E'\n'
          || 'Personne : ' || new.person_first || ' ' || new.person_last || E'\n'
          || 'Refusé par : ' || v_actor || E'\n\nMotif :\n'
          || coalesce(nullif(new.refusal_reason, ''), 'Non précisé'));
      end if;
    end if;
  end if;

  v_changed := (new.person_first, new.person_last, new.person_info, new.agents_concernes, new.motif,
                new.description, new.preuves, new.objets_recherches, new.risques, new.date_souhaitee,
                new.heure_souhaitee, new.infos_complementaires)
               is distinct from
               (old.person_first, old.person_last, old.person_info, old.agents_concernes, old.motif,
                old.description, old.preuves, old.objets_recherches, old.risques, old.date_souhaitee,
                old.heure_souhaitee, old.infos_complementaires);
  if v_changed then
    perform public.log_history(new.id, 'Modification des informations du mandat #' || new.number);
  end if;
  return new;
end $$;

drop trigger if exists mandates_after_update_trg on public.mandates;
create trigger mandates_after_update_trg after update on public.mandates
for each row execute function public.mandates_after_update();

create or replace function public.mandates_before_delete() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.mandate_history (mandate_id, mandate_number, actor_id, actor_name, message)
  values (null, old.number, auth.uid(), public.actor_name(), 'Suppression du mandat #' || old.number);
  return old;
end $$;

drop trigger if exists mandates_before_delete_trg on public.mandates;
create trigger mandates_before_delete_trg before delete on public.mandates
for each row execute function public.mandates_before_delete();

create or replace function public.child_history() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_verb text;
  v_what text;
begin
  r := case when tg_op = 'DELETE' then old else new end;
  v_verb := case tg_op when 'INSERT' then 'Ajout' when 'UPDATE' then 'Modification' else 'Suppression' end;

  if tg_op = 'INSERT' and exists (
    select 1 from public.mandates where id = r.mandate_id and created_at > now() - interval '20 seconds'
  ) then
    return r;
  end if;

  if tg_table_name = 'mandate_complices' then
    v_what := 'du complice ' || btrim(coalesce(r.prenom,'') || ' ' || coalesce(r.nom,''));
  elsif tg_table_name = 'mandate_terrains' then
    v_what := 'du terrain #' || r.numero || case when coalesce(r.adresse,'') <> '' then ' (' || r.adresse || ')' else '' end;
  else
    v_what := 'du véhicule ' || btrim(coalesce(r.marque,'') || ' ' || coalesce(r.modele,''))
              || case when coalesce(r.plaque,'') <> '' then ' immatriculé ' || r.plaque else '' end;
  end if;

  perform public.log_history(r.mandate_id, v_verb || ' ' || v_what);
  return r;
end $$;

drop trigger if exists complices_history_trg on public.mandate_complices;
create trigger complices_history_trg after insert or update or delete on public.mandate_complices
for each row execute function public.child_history();
drop trigger if exists terrains_history_trg on public.mandate_terrains;
create trigger terrains_history_trg after insert or update or delete on public.mandate_terrains
for each row execute function public.child_history();
drop trigger if exists vehicles_history_trg on public.mandate_vehicles;
create trigger vehicles_history_trg after insert or update or delete on public.mandate_vehicles
for each row execute function public.child_history();

create or replace function public.members_after_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r public.mandate_members;
  v_name text;
  v_creator uuid;
  v_number text;
begin
  r := case when tg_op = 'DELETE' then old else new end;
  select prenom || ' ' || nom into v_name from public.profiles where id = r.user_id;
  select created_by, number into v_creator, v_number from public.mandates where id = r.mandate_id;
  if v_number is null then return r; end if;

  if tg_op = 'INSERT' then
    if r.user_id is distinct from v_creator then
      perform public.log_history(r.mandate_id, 'Ajout de ' || coalesce(v_name, 'un agent') || ' au dossier');
      if r.user_id is distinct from auth.uid() then
        insert into public.notifications (user_id, type, title, body, mandate_id)
        values (r.user_id, 'member_added', 'Ajouté à un dossier', 'Vous avez accès au mandat #' || v_number, r.mandate_id);
      end if;
    end if;
  else
    perform public.log_history(r.mandate_id, 'Retrait de ' || coalesce(v_name, 'un agent') || ' du dossier');
  end if;
  return r;
end $$;

drop trigger if exists members_after_change_trg on public.mandate_members;
create trigger members_after_change_trg after insert or delete on public.mandate_members
for each row execute function public.members_after_change();

create or replace function public.files_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.log_history(new.mandate_id,
    case when coalesce(new.mime_type,'') like 'image/%' then 'Ajout d''une photo au dossier'
         else 'Ajout d''un document au dossier' end
    || ' (' || new.file_name || ')');
  return new;
end $$;

drop trigger if exists files_after_insert_trg on public.mandate_files;
create trigger files_after_insert_trg after insert on public.mandate_files
for each row execute function public.files_after_insert();

create or replace function public.messages_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_number text;
  v_preview boolean;
  v_txt text;
begin
  select number into v_number from public.mandates where id = new.mandate_id;

  insert into public.notifications (user_id, type, title, body, mandate_id)
  select mm.user_id, 'message', 'Nouveau message – #' || v_number,
         coalesce(new.author_name, '?') || ' : ' || left(coalesce(nullif(new.body,''), '[pièce jointe]'), 80),
         new.mandate_id
  from public.mandate_members mm
  join public.profiles p on p.id = mm.user_id and p.is_active
  where mm.mandate_id = new.mandate_id and mm.user_id is distinct from new.user_id;

  select coalesce((value #>> '{}')::boolean, false) into v_preview
  from public.settings where key = 'discord_message_preview';

  v_txt := E'💬 **NOUVEAU MESSAGE**\n\n'
        || 'Mandat : #' || v_number || E'\n'
        || 'Auteur : ' || coalesce(new.author_name, '?');
  if v_preview is true and coalesce(new.body,'') <> '' then
    v_txt := v_txt || E'\nAperçu : ' || left(new.body, 80);
  end if;
  perform public.discord_notify('message', v_txt);
  return new;
end $$;

drop trigger if exists messages_after_insert_trg on public.mandate_messages;
create trigger messages_after_insert_trg after insert on public.mandate_messages
for each row execute function public.messages_after_insert();

create or replace function public.announcements_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.author_id := auth.uid();
  new.author_name := public.actor_name();
  return new;
end $$;

drop trigger if exists announcements_before_insert_trg on public.announcements;
create trigger announcements_before_insert_trg before insert on public.announcements
for each row execute function public.announcements_before_insert();

create or replace function public.announcements_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_embed jsonb;
  v_emoji text;
  v_label text;
  v_color int;
begin
  insert into public.notifications (user_id, type, title, body)
  select id, 'announcement', 'Nouvelle annonce citoyenne', left(new.title, 120)
  from public.profiles
  where is_active and role is not null and id is distinct from auth.uid();

  v_emoji := case new.category when 'evenement' then '🎉' when 'travaux' then '🚧' when 'securite' then '🛡️' when 'urgent' then '🚨' else 'ℹ️' end;
  v_label := case new.category when 'evenement' then 'Événement' when 'travaux' then 'Travaux' when 'securite' then 'Sécurité' when 'urgent' then 'Urgent' else 'Information' end;
  v_color := case new.category when 'evenement' then 10181046 when 'travaux' then 15105570 when 'securite' then 1752220 when 'urgent' then 15158332 else 3447003 end;

  v_embed := jsonb_build_object(
    'title', v_emoji || ' ' || left(new.title, 240),
    'description', left(new.body, 3800),
    'color', v_color,
    'author', jsonb_build_object('name', 'Annonce citoyenne – ' || v_label),
    'footer', jsonb_build_object('text', 'Mairie d''Amboise – ' || coalesce(new.author_name, 'Mairie')),
    'timestamp', to_char(new.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  );
  if coalesce(new.image_url, '') <> '' then
    v_embed := v_embed || jsonb_build_object('image', jsonb_build_object('url', new.image_url));
  end if;

  perform public.discord_embed('announcement', '', v_embed, 'discord_webhook_announcements');
  return new;
end $$;

drop trigger if exists announcements_after_insert_trg on public.announcements;
create trigger announcements_after_insert_trg after insert on public.announcements
for each row execute function public.announcements_after_insert();

create or replace function public.profiles_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.role is null and auth.uid() is null then
    perform public.notify_mayors('signup', 'Nouvelle inscription',
      new.prenom || ' ' || new.nom || ' attend votre validation.', null);
    perform public.discord_notify('signup',
      E'🆕 **NOUVELLE INSCRIPTION**\n\n' || new.prenom || ' ' || new.nom
      || E' vient de créer un compte.\nAttribuez-lui un rôle dans la page Utilisateurs.');
  end if;
  return new;
end $$;

drop trigger if exists profiles_after_insert_trg on public.profiles;
create trigger profiles_after_insert_trg after insert on public.profiles
for each row execute function public.profiles_after_insert();
