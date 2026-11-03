-- Mallorca Riders: edición colaborativa de rutas compartidas.
-- Ejecutar una sola vez en Supabase > SQL Editor antes de desplegar esta versión.

alter table public.shared_routes
  add column if not exists version integer not null default 1,
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.shared_route_versions (
  id bigint generated always as identity primary key,
  route_id uuid not null references public.shared_routes(id) on delete cascade,
  version integer not null,
  route_data jsonb not null,
  changed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(route_id, version)
);

alter table public.shared_route_versions enable row level security;

drop policy if exists "Members can view shared route history" on public.shared_route_versions;
create policy "Members can view shared route history"
on public.shared_route_versions for select to authenticated
using (
  exists (
    select 1 from public.shared_routes r
    where r.id = route_id and r.is_published = true
  )
);

-- Todos los miembros autenticados pueden actualizar una ruta publicada,
-- pero solo mediante esta función, que bloquea la fila y comprueba la versión.
create or replace function public.update_shared_route(
  p_route_id uuid,
  p_expected_version integer,
  p_route_data jsonb
)
returns table(new_version integer, changed_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  existing public.shared_routes%rowtype;
  next_title text;
  next_region text;
  next_type text;
  next_distance numeric(7,2);
  next_duration integer;
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión para editar una ruta compartida.';
  end if;
  if jsonb_typeof(p_route_data) <> 'object'
     or jsonb_typeof(p_route_data->'shape') <> 'array'
     or jsonb_array_length(p_route_data->'shape') < 2 then
    raise exception 'Los datos de la ruta no son válidos.';
  end if;

  select * into existing
  from public.shared_routes
  where id = p_route_id and is_published = true
  for update;

  if not found then
    raise exception 'No se encuentra la ruta compartida o ya no está publicada.';
  end if;
  if existing.version <> p_expected_version then
    raise exception 'VERSION_CONFLICT: otro miembro ha actualizado esta ruta. Recarga la última versión antes de guardar.';
  end if;

  next_title := left(coalesce(nullif(p_route_data->>'name',''), existing.title), 80);
  if char_length(next_title) < 3 then next_title := 'Ruta compartida'; end if;
  next_region := coalesce(nullif(p_route_data->>'region',''), existing.region);
  if next_region not in ('mallorca','menorca','ibiza','formentera','peninsula') then
    next_region := existing.region;
  end if;
  next_type := coalesce(nullif(p_route_data->>'type',''), existing.route_type);
  if next_type not in ('Mixta','Curvas','Costa','Montaña') then next_type := existing.route_type; end if;
  next_distance := greatest(0, coalesce(nullif(regexp_replace(coalesce(p_route_data->>'km','0'), '[^0-9,.]', '', 'g'), '')::numeric, existing.distance_km));
  next_duration := greatest(0, coalesce(existing.duration_minutes, 0));
  if coalesce(p_route_data->>'duration','') ~ '^[0-9]+ h [0-9]+ min$' then
    next_duration := (split_part(p_route_data->>'duration',' h ',1)::integer * 60)
      + split_part(split_part(p_route_data->>'duration',' h ',2),' min',1)::integer;
  elsif coalesce(p_route_data->>'duration','') ~ '^[0-9]+ min$' then
    next_duration := split_part(p_route_data->>'duration',' min',1)::integer;
  end if;

  insert into public.shared_route_versions(route_id, version, route_data, changed_by)
  values(existing.id, existing.version, existing.route_geojson, auth.uid());

  update public.shared_routes
  set title = next_title,
      region = next_region,
      route_type = next_type,
      distance_km = next_distance,
      duration_minutes = next_duration,
      route_geojson = p_route_data,
      stops = coalesce(p_route_data->'realStops', '[]'::jsonb),
      version = existing.version + 1,
      updated_at = now()
  where id = existing.id;

  return query select existing.version + 1, now();
end;
$$;

revoke all on function public.update_shared_route(uuid, integer, jsonb) from public;
grant execute on function public.update_shared_route(uuid, integer, jsonb) to authenticated;

-- Habilitar avisos en tiempo real para que otros miembros vean los cambios.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'shared_routes'
  ) then
    alter publication supabase_realtime add table public.shared_routes;
  end if;
end $$;
