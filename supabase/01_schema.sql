create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;
create extension if not exists pg_net;

create table if not exists public.roles (
  code text primary key,
  label text not null,
  service text not null check (service in ('mairie','police','gendarmerie')),
  can_create_mandate boolean not null default false,
  sort int not null default 0
);

insert into public.roles (code,label,service,can_create_mandate,sort) values
  ('maire','Maire','mairie',false,1),
  ('employe','Employé de mairie','mairie',false,2),
  ('chef_police','Chef Police','police',true,3),
  ('policier','Policier','police',false,4),
  ('chef_gendarmerie','Chef Gendarmerie','gendarmerie',true,5),
  ('gendarme','Gendarme','gendarmerie',false,6)
on conflict (code) do update
  set label=excluded.label, service=excluded.service,
      can_create_mandate=excluded.can_create_mandate, sort=excluded.sort;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  prenom text not null,
  nom text not null,
  role text references public.roles(code),
  permissions jsonb not null default '{}'::jsonb,
  is_active boolean not null default false,
  login_email text,
  created_by uuid,
  created_at timestamptz not null default now(),
  last_login timestamptz
);
create unique index if not exists profiles_name_uq on public.profiles (lower(prenom), lower(nom));
create unique index if not exists profiles_single_mayor on public.profiles (role) where role = 'maire';
create index if not exists profiles_role_idx on public.profiles (role);

create table if not exists public.mandates (
  id uuid primary key default gen_random_uuid(),
  number text unique,
  service text not null check (service in ('police','gendarmerie')),
  status text not null default 'en_attente' check (status in ('en_attente','accepte','refuse')),
  person_first text not null,
  person_last text not null,
  person_info text,
  agents_concernes text,
  motif text not null,
  description text,
  preuves text,
  objets_recherches text,
  risques text,
  date_souhaitee date,
  heure_souhaitee time,
  infos_complementaires text,
  requester_name text,
  created_by uuid references public.profiles(id) on delete set null,
  decided_by uuid references public.profiles(id) on delete set null,
  decided_by_name text,
  decided_at timestamptz,
  refusal_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.mandate_complices (
  id uuid primary key default gen_random_uuid(),
  mandate_id uuid not null references public.mandates(id) on delete cascade,
  prenom text not null default '',
  nom text not null default '',
  infos text,
  created_at timestamptz not null default now()
);

create table if not exists public.mandate_terrains (
  id uuid primary key default gen_random_uuid(),
  mandate_id uuid not null references public.mandates(id) on delete cascade,
  numero text not null,
  adresse text,
  infos text,
  created_at timestamptz not null default now()
);

create table if not exists public.mandate_vehicles (
  id uuid primary key default gen_random_uuid(),
  mandate_id uuid not null references public.mandates(id) on delete cascade,
  marque text not null default '',
  modele text not null default '',
  couleur text,
  plaque text,
  infos text,
  created_at timestamptz not null default now()
);

create table if not exists public.mandate_members (
  mandate_id uuid not null references public.mandates(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  added_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (mandate_id, user_id)
);

create table if not exists public.mandate_messages (
  id uuid primary key default gen_random_uuid(),
  mandate_id uuid not null references public.mandates(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  author_name text,
  body text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.mandate_files (
  id uuid primary key default gen_random_uuid(),
  mandate_id uuid not null references public.mandates(id) on delete cascade,
  message_id uuid references public.mandate_messages(id) on delete cascade,
  path text not null,
  file_name text not null,
  mime_type text,
  size_bytes bigint,
  uploaded_by uuid references public.profiles(id) on delete set null,
  uploaded_by_name text,
  created_at timestamptz not null default now()
);

create table if not exists public.mandate_reads (
  mandate_id uuid not null references public.mandates(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (mandate_id, user_id)
);

create table if not exists public.mandate_history (
  id bigint generated always as identity primary key,
  mandate_id uuid references public.mandates(id) on delete set null,
  mandate_number text,
  actor_id uuid,
  actor_name text,
  message text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  mandate_id uuid references public.mandates(id) on delete cascade,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.settings (
  key text primary key,
  value jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create table if not exists public.private_settings (
  key text primary key,
  value text,
  updated_at timestamptz not null default now()
);

create table if not exists public.mandate_counters (
  year int primary key,
  last_value int not null default 0
);

create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null default '',
  image_path text,
  image_url text,
  author_id uuid references public.profiles(id) on delete set null,
  author_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists mandates_status_idx on public.mandates (status);
create index if not exists mandates_service_idx on public.mandates (service);
create index if not exists mandates_created_idx on public.mandates (created_at desc);
create index if not exists mandates_number_trgm on public.mandates using gin (number extensions.gin_trgm_ops);
create index if not exists mandates_pfirst_trgm on public.mandates using gin (person_first extensions.gin_trgm_ops);
create index if not exists mandates_plast_trgm on public.mandates using gin (person_last extensions.gin_trgm_ops);
create index if not exists mandates_agents_trgm on public.mandates using gin (agents_concernes extensions.gin_trgm_ops);
create index if not exists complices_mandate_idx on public.mandate_complices (mandate_id);
create index if not exists complices_nom_trgm on public.mandate_complices using gin (nom extensions.gin_trgm_ops);
create index if not exists complices_prenom_trgm on public.mandate_complices using gin (prenom extensions.gin_trgm_ops);
create index if not exists terrains_mandate_idx on public.mandate_terrains (mandate_id);
create index if not exists terrains_numero_trgm on public.mandate_terrains using gin (numero extensions.gin_trgm_ops);
create index if not exists vehicles_mandate_idx on public.mandate_vehicles (mandate_id);
create index if not exists vehicles_plaque_trgm on public.mandate_vehicles using gin (plaque extensions.gin_trgm_ops);
create index if not exists members_user_idx on public.mandate_members (user_id);
create index if not exists messages_conv_idx on public.mandate_messages (mandate_id, created_at desc);
create index if not exists files_mandate_idx on public.mandate_files (mandate_id, created_at desc);
create index if not exists files_message_idx on public.mandate_files (message_id);
create index if not exists history_created_idx on public.mandate_history (created_at desc);
create index if not exists history_mandate_idx on public.mandate_history (mandate_id, created_at desc);
create index if not exists notifs_user_idx on public.notifications (user_id, is_read, created_at desc);
create index if not exists announcements_created_idx on public.announcements (created_at desc);

insert into public.settings (key, value) values
  ('mairie_name', to_jsonb('MAIRIE D''AMBOISE'::text)),
  ('maire_name', to_jsonb('Gabin Muller'::text)),
  ('maire_title', to_jsonb('Maire d''Amboise'::text)),
  ('number_prefix', to_jsonb(''::text)),
  ('number_pad', to_jsonb(4)),
  ('pdf_city', to_jsonb('Amboise'::text)),
  ('pdf_extra', to_jsonb('République française – Nova Life RP'::text)),
  ('pdf_footer', to_jsonb('Document officiel de la Mairie d''Amboise – Nova Life RP'::text)),
  ('notify_new', to_jsonb(true)),
  ('notify_decision', to_jsonb(true)),
  ('notify_message', to_jsonb(true)),
  ('discord_message_preview', to_jsonb(false)),
  ('notify_announcement', to_jsonb(true))
on conflict (key) do nothing;

insert into public.private_settings (key, value) values ('discord_webhook', '')
on conflict (key) do nothing;

create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists mandates_updated_at on public.mandates;
create trigger mandates_updated_at before update on public.mandates
for each row execute function public.set_updated_at();

drop trigger if exists announcements_updated_at on public.announcements;
create trigger announcements_updated_at before update on public.announcements
for each row execute function public.set_updated_at();
