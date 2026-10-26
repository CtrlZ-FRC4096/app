-- A small stand-in for the parts of Supabase that the migrations rely on, so
-- the tests can run them in an in-memory Postgres (PGlite) on any computer.
-- It copies how Supabase sets these up; it is not used anywhere else.

-- The roles Supabase uses. The browser talks to the database as anon when
-- nobody is signed in and as authenticated when someone is.
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
-- Supabase's sign-in service, which adds people to auth.users.
create role supabase_auth_admin nologin noinherit;

-- Supabase gives these roles everything on new tables in public by default,
-- so a table's permission rules are what actually protect it.
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

-- Accounts, owned by the sign-in service like in Supabase.
create schema auth;
grant usage on schema auth to anon, authenticated, service_role, supabase_auth_admin;

create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_app_meta_data jsonb not null default '{}',
  raw_user_meta_data jsonb not null default '{}',
  created_at timestamptz not null default now()
);
alter table auth.users owner to supabase_auth_admin;

-- What each sign-in provider (Slack) said about a person. Supabase updates
-- this on every sign-in; people can't change it themselves.
create table auth.identities (
  id uuid primary key default gen_random_uuid(),
  provider_id text not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  identity_data jsonb not null,
  provider text not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (provider_id, provider)
);
alter table auth.identities owner to supabase_auth_admin;

-- Who is asking. Supabase reads this from the signed-in person's token.
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

create function auth.role() returns text language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;

create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')
  )::jsonb
$$;

grant execute on function auth.uid(), auth.role(), auth.jwt() to anon, authenticated, service_role;

-- Supabase's live updates read changes from this publication.
create publication supabase_realtime;
