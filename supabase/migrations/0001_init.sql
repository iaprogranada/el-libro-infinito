-- El Libro Infinito · esquema inicial
-- Pega este archivo entero en Supabase → SQL Editor → Run (una sola vez).
-- Toda la escritura pasa por el servidor (clave service_role). El público no tiene acceso directo.

create extension if not exists pgcrypto;

-- Párrafos publicados. n es el número de párrafo, sin huecos.
create table public.paragraphs (
  n            bigint primary key,
  username     text not null check (char_length(username) between 2 and 24),
  body         text not null check (char_length(body) between 1 and 500),
  signed       boolean not null default false,
  gold         boolean not null default false,
  word_count   int not null default 0,
  submission_id uuid unique,
  created_at   timestamptz not null default now()
);
create index paragraphs_username_lower_idx on public.paragraphs (lower(username));

-- Códigos de invitación de un solo uso.
-- kind 'firma' = párrafo + firma gratis · kind 'oro' = párrafo + firma + dorado gratis
create table public.invites (
  code         text primary key,
  kind         text not null check (kind in ('firma', 'oro')),
  batch        int not null default 1,
  reserved_by  uuid,
  reserved_at  timestamptz,
  used_at      timestamptz,
  used_by_n    bigint references public.paragraphs (n),
  created_at   timestamptz not null default now()
);

-- Cada intento de escribir: ya ha pasado el filtro y espera pago (o se publica directo con invitación).
create table public.submissions (
  id            uuid primary key default gen_random_uuid(),
  username      text not null,
  body          text not null,
  signed        boolean not null default false,
  gold          boolean not null default false,
  amount_cents  int not null check (amount_cents >= 0),
  invite_code   text references public.invites (code),
  provider      text check (provider in ('stripe', 'paypal', 'invite')),
  provider_ref  text,
  status        text not null default 'pending' check (status in ('pending', 'published', 'cancelled')),
  published_n   bigint references public.paragraphs (n),
  created_at    timestamptz not null default now()
);
create index submissions_provider_ref_idx on public.submissions (provider_ref);

-- El resumen que se reescribe solo (una única fila).
create table public.book_summary (
  id                int primary key default 1 check (id = 1),
  sections          jsonb not null,
  after_n           bigint not null default 0,
  updated_at        timestamptz not null default now(),
  refreshing_since  timestamptz
);

-- Límite de envíos por IP (anonimizada).
create table public.rate_hits (
  key  text not null,
  at   timestamptz not null default now()
);
create index rate_hits_key_at_idx on public.rate_hits (key, at);

-- Solo el servidor (service_role) usa las tablas. Con la clave pública no se ve nada:
-- no hay políticas, así que RLS lo bloquea todo aunque el proyecto exponga las tablas.
grant usage on schema public to service_role;
grant select, insert, update, delete on all tables in schema public to service_role;

alter table public.paragraphs   enable row level security;
alter table public.invites      enable row level security;
alter table public.submissions  enable row level security;
alter table public.book_summary enable row level security;
alter table public.rate_hits    enable row level security;

-- Publica un envío de forma atómica e idempotente (los avisos de pago pueden llegar dos veces).
create or replace function public.publish_submission(p_id uuid)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  s     submissions%rowtype;
  new_n bigint;
begin
  select * into s from submissions where id = p_id for update;
  if not found then
    raise exception 'submission % not found', p_id;
  end if;
  if s.status = 'published' then
    return s.published_n;
  end if;

  -- Un solo publicador a la vez: numeración sin huecos.
  perform pg_advisory_xact_lock(8086);
  select coalesce(max(n), 0) + 1 into new_n from paragraphs;

  insert into paragraphs (n, username, body, signed, gold, word_count, submission_id)
  values (
    new_n, s.username, s.body, s.signed, s.gold,
    coalesce(array_length(regexp_split_to_array(btrim(s.body), '\s+'), 1), 0),
    s.id
  );

  update submissions set status = 'published', published_n = new_n where id = p_id;

  if s.invite_code is not null then
    update invites set used_at = now(), used_by_n = new_n
    where code = s.invite_code and used_at is null;
  end if;

  return new_n;
end;
$$;

-- Reserva una invitación para un envío. Devuelve el tipo, o null si no existe, ya se usó
-- o la tiene reservada otra persona (las reservas caducan a los 45 minutos).
create or replace function public.reserve_invite(p_code text, p_submission uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  k text;
begin
  update invites
     set reserved_by = p_submission, reserved_at = now()
   where code = upper(btrim(p_code))
     and used_at is null
     and (reserved_by is null or reserved_by = p_submission or reserved_at < now() - interval '45 minutes')
  returning kind into k;
  return k;
end;
$$;

-- Libera la invitación y cancela un envío que no se llegó a pagar.
create or replace function public.cancel_submission(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update submissions set status = 'cancelled' where id = p_id and status = 'pending';
  update invites set reserved_by = null, reserved_at = null
   where reserved_by = p_id and used_at is null;
end;
$$;

-- Contadores de la cabecera.
create or replace function public.book_stats()
returns table (paragraphs bigint, authors bigint, words bigint, last_n bigint)
language sql
stable
security definer
set search_path = public
as $$
  select count(*), count(distinct lower(username)), coalesce(sum(word_count), 0), coalesce(max(n), 0)
  from paragraphs;
$$;

-- Devuelve true si la clave aún no ha superado p_max intentos en la ventana.
create or replace function public.rate_check(p_key text, p_max int, p_window_seconds int)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  c int;
begin
  if random() < 0.02 then
    delete from rate_hits where at < now() - interval '1 day';
  end if;
  select count(*) into c from rate_hits
   where key = p_key and at > now() - make_interval(secs => p_window_seconds);
  if c >= p_max then
    return false;
  end if;
  insert into rate_hits (key) values (p_key);
  return true;
end;
$$;

-- Marca que alguien está reescribiendo el resumen (evita trabajos duplicados).
create or replace function public.claim_summary_refresh()
returns table (sections jsonb, after_n bigint)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update book_summary b
     set refreshing_since = now()
   where b.id = 1
     and (b.refreshing_since is null or b.refreshing_since < now() - interval '3 minutes')
  returning b.sections, b.after_n;
end;
$$;

-- Solo el servidor (service_role) puede ejecutar estas funciones.
revoke execute on function public.publish_submission(uuid)        from public, anon, authenticated;
revoke execute on function public.reserve_invite(text, uuid)      from public, anon, authenticated;
revoke execute on function public.cancel_submission(uuid)         from public, anon, authenticated;
revoke execute on function public.book_stats()                    from public, anon, authenticated;
revoke execute on function public.rate_check(text, int, int)      from public, anon, authenticated;
revoke execute on function public.claim_summary_refresh()         from public, anon, authenticated;
grant execute on function public.publish_submission(uuid)         to service_role;
grant execute on function public.reserve_invite(text, uuid)       to service_role;
grant execute on function public.cancel_submission(uuid)          to service_role;
grant execute on function public.book_stats()                     to service_role;
grant execute on function public.rate_check(text, int, int)       to service_role;
grant execute on function public.claim_summary_refresh()          to service_role;
