-- Mallorca Riders Routes: esquema inicial para Supabase
-- Ejecutar en Supabase > SQL Editor. Activa RLS y limita los datos privados.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nickname text not null unique check (char_length(nickname) between 3 and 24 and nickname ~ '^[A-Za-z0-9_ -]+$'),
  avatar_url text,
  bio text not null default '' check (char_length(bio) <= 240),
  xp integer not null default 0 check (xp >= 0),
  level integer not null default 1 check (level >= 1),
  founder_number integer unique,
  created_at timestamptz not null default now()
);

create unique index if not exists profiles_nickname_case_insensitive_idx on public.profiles (lower(nickname));

create table if not exists public.shared_routes (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(title) between 3 and 80),
  region text not null check (region in ('mallorca','menorca','ibiza','formentera','peninsula')),
  route_type text not null default 'Mixta' check (route_type in ('Mixta','Curvas','Costa','Montaña')),
  distance_km numeric(7,2) not null default 0 check (distance_km >= 0),
  duration_minutes integer not null default 0 check (duration_minutes >= 0),
  route_geojson jsonb not null,
  stops jsonb not null default '[]'::jsonb,
  notes text not null default '' check (char_length(notes) <= 500),
  is_published boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists shared_routes_creator_idx on public.shared_routes (creator_id);
create index if not exists shared_routes_published_idx on public.shared_routes (is_published, created_at desc);

create table if not exists public.route_participants (
  route_id uuid not null references public.shared_routes(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'joined' check (status in ('joined','completed','cancelled')),
  joined_at timestamptz not null default now(),
  primary key (route_id, user_id)
);

alter table public.profiles enable row level security;
alter table public.shared_routes enable row level security;
alter table public.route_participants enable row level security;

-- Perfil: los usuarios registrados pueden consultar perfiles públicos;
-- cada persona solo puede crear/editar su propio perfil.
drop policy if exists "Profiles visible to signed-in members" on public.profiles;
create policy "Profiles visible to signed-in members"
on public.profiles for select to authenticated using (true);

drop policy if exists "Users can create their own profile" on public.profiles;
create policy "Users can create their own profile"
on public.profiles for insert to authenticated with check (auth.uid() = id);

drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile"
on public.profiles for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

-- Rutas: miembros registrados ven rutas publicadas y las suyas;
-- cada usuario solo publica, modifica o elimina sus propias rutas.
drop policy if exists "Members can view published routes and own drafts" on public.shared_routes;
create policy "Members can view published routes and own drafts"
on public.shared_routes for select to authenticated
using (is_published = true or creator_id = auth.uid());

drop policy if exists "Members can publish their own routes" on public.shared_routes;
create policy "Members can publish their own routes"
on public.shared_routes for insert to authenticated
with check (creator_id = auth.uid());

drop policy if exists "Creators can update their own routes" on public.shared_routes;
create policy "Creators can update their own routes"
on public.shared_routes for update to authenticated
using (creator_id = auth.uid()) with check (creator_id = auth.uid());

drop policy if exists "Creators can delete their own routes" on public.shared_routes;
create policy "Creators can delete their own routes"
on public.shared_routes for delete to authenticated
using (creator_id = auth.uid());

-- Participación: cada miembro ve quién se apunta a rutas visibles,
-- y solo puede apuntarse/cancelar su propia participación.
drop policy if exists "Members can view participants of visible routes" on public.route_participants;
create policy "Members can view participants of visible routes"
on public.route_participants for select to authenticated
using (
  user_id = auth.uid()
  or exists (
    select 1 from public.shared_routes r
    where r.id = route_id and (r.is_published = true or r.creator_id = auth.uid())
  )
);

drop policy if exists "Members can join as themselves" on public.route_participants;
create policy "Members can join as themselves"
on public.route_participants for insert to authenticated
with check (
  user_id = auth.uid()
  and exists (select 1 from public.shared_routes r where r.id = route_id and r.is_published = true)
);

drop policy if exists "Members can update their own participation" on public.route_participants;
create policy "Members can update their own participation"
on public.route_participants for update to authenticated
using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "Members can cancel their own participation" on public.route_participants;
create policy "Members can cancel their own participation"
on public.route_participants for delete to authenticated
using (user_id = auth.uid());

-- Create a starter profile after signup. The nickname is supplied in auth metadata;
-- the app must validate availability and ask for a different nickname on conflict.
create or replace function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  requested_nickname text;
begin
  requested_nickname := coalesce(new.raw_user_meta_data ->> 'nickname', '');
  if char_length(requested_nickname) < 3
     or char_length(requested_nickname) > 24
     or requested_nickname !~ '^[A-Za-z0-9_ -]+$' then
    requested_nickname := 'Rider_' || substr(replace(new.id::text, '-', ''), 1, 8);
  end if;

  -- If the chosen nickname is already taken, create a unique temporary one.
  if exists (select 1 from public.profiles p where lower(p.nickname) = lower(requested_nickname)) then
    requested_nickname := 'Rider_' || substr(replace(new.id::text, '-', ''), 1, 12);
  end if;

  insert into public.profiles (id, nickname, xp, level, founder_number)
  values (new.id, requested_nickname, 0, 1, null)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
after insert on auth.users
for each row execute procedure public.create_profile_for_new_user();


-- Prevent users from awarding themselves XP, levels, or founder status.
create or replace function public.protect_profile_progress()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is not null then
    if tg_op = 'INSERT' then
      new.xp := 0;
      new.level := 1;
      new.founder_number := null;
      new.created_at := now();
    else
      new.xp := old.xp;
      new.level := old.level;
      new.founder_number := old.founder_number;
      new.created_at := old.created_at;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists protect_profile_progress on public.profiles;
create trigger protect_profile_progress
before insert or update on public.profiles
for each row execute procedure public.protect_profile_progress();
