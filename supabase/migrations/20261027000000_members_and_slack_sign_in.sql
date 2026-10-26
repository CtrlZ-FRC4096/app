-- Team members, roles, and Sign in with Slack.
--
-- Everyone signs in with Slack. The first time someone signs in, Supabase
-- adds them to auth.users, and the trigger below adds them to
-- public.members as a student, but only if they signed in through the
-- team's Slack workspace. Anyone else is turned away before an account is
-- made. Admins can then make people mentors or admins, or switch off
-- someone's access.
--
-- The permission rules on every table use private.is_member(),
-- private.is_mentor() and private.is_admin() from this file.


-- The private schema is for things the app never reads directly. Supabase
-- only puts the public schema on the web API, so nothing here is reachable
-- from the browser.
create schema private;

create table private.settings (
  key text primary key,
  value text not null
);

comment on table private.settings is
  'Database settings. slack_team_id is the ID of the team''s Slack workspace (it starts with T). Until it is set, nobody can sign in.';

revoke all on table private.settings from public;


-- Everyone who has signed in.
create table public.members (
  id uuid primary key references auth.users (id) on delete cascade,
  slack_user_id text not null unique,
  name text not null,
  avatar_url text,
  role text not null default 'student' check (role in ('student', 'mentor', 'admin')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

comment on column public.members.active is
  'False when an admin has switched off this person''s access, for example after they leave the team.';

alter table public.members enable row level security;

-- Signed-out visitors get nothing. Signed-in people can read the list, and
-- can only ever change role and active (and the rules below decide who).
revoke all on table public.members from anon, authenticated;
grant select on table public.members to authenticated;
grant update (role, active) on table public.members to authenticated;

-- Lets the app hear about role changes and switched-off access straight away.
alter publication supabase_realtime add table public.members;


-- Who the signed-in person is. These run with the owner's rights
-- (security definer) so they can read members without going through the
-- members table's own rules, which use them.

-- The signed-in person's role, or null if they aren't an active member.
create function private.my_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.members where id = auth.uid() and active
$$;

-- True for anyone on the team whose access is on.
create function private.is_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.my_role() is not null
$$;

-- True for mentors and admins.
create function private.is_mentor()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.my_role() in ('mentor', 'admin'), false)
$$;

-- True for admins.
create function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.my_role() = 'admin', false)
$$;

revoke all on function private.my_role(), private.is_member(), private.is_mentor(), private.is_admin() from public;
grant usage on schema private to authenticated;
grant execute on function private.my_role(), private.is_member(), private.is_mentor(), private.is_admin() to authenticated;


-- Permission rules for members.

create policy "Members can see who is on the team"
  on public.members for select to authenticated
  using ((select private.is_member()) or id = (select auth.uid()));

create policy "Admins can change roles and switch off access"
  on public.members for update to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

-- There are no insert or delete rules on purpose. Rows are added by Slack
-- sign-in below, and removed only when an admin deletes the person in the
-- Supabase dashboard (Authentication > Users).


-- Never leave the team without an admin.
create function private.keep_an_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role = 'admin' and old.active and (new.role <> 'admin' or not new.active)
    and not exists (
      select 1 from public.members
      where role = 'admin' and active and id <> old.id
    )
  then
    raise exception 'The team needs at least one admin. Make someone else an admin first.';
  end if;
  return new;
end;
$$;

revoke all on function private.keep_an_admin() from public;

create trigger keep_an_admin
  before update of role, active on public.members
  for each row execute function private.keep_an_admin();


-- Sign in with Slack.
--
-- Runs when Supabase makes a new account. Raising an error here stops the
-- account from being made, so the person can't sign in. Supabase stores what
-- Slack says about the person in raw_user_meta_data: sub is their Slack user
-- ID, and custom_claims holds the workspace they signed in through.
create function private.add_slack_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  team_id text := (select value from private.settings where key = 'slack_team_id');
  signed_in_team text := new.raw_user_meta_data -> 'custom_claims' ->> 'https://slack.com/team_id';
begin
  if new.raw_app_meta_data ->> 'provider' is distinct from 'slack_oidc' then
    raise exception 'Sign in with Slack is the only way into the team app.';
  end if;
  if team_id is null then
    raise exception 'Slack sign-in is not set up yet: private.settings has no slack_team_id.';
  end if;
  if signed_in_team is distinct from team_id then
    raise exception 'Only members of the team''s Slack workspace can sign in.';
  end if;

  insert into public.members (id, slack_user_id, name, avatar_url)
  values (
    new.id,
    new.raw_user_meta_data ->> 'sub',
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'name'), ''), 'Team member'),
    new.raw_user_meta_data ->> 'picture'
  );
  return new;
end;
$$;

-- Keeps names and pictures up to date. Every time someone signs in,
-- Supabase saves what Slack says about them in auth.identities and then
-- updates raw_user_meta_data, which runs this. The name is read from
-- auth.identities, not raw_user_meta_data: people can change their own
-- raw_user_meta_data from the browser, so a student could otherwise rename
-- themselves after a mentor. Only Slack can change auth.identities.
create function private.update_slack_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  slack jsonb := (
    select identity_data from auth.identities
    where user_id = new.id and provider = 'slack_oidc'
    order by updated_at desc nulls last
    limit 1
  );
begin
  if slack is null then
    return new;
  end if;
  update public.members
  set
    name = coalesce(nullif(trim(slack ->> 'name'), ''), name),
    avatar_url = slack ->> 'picture'
  where id = new.id;
  return new;
end;
$$;

revoke all on function private.add_slack_member(), private.update_slack_profile() from public;

create trigger add_slack_member
  after insert on auth.users
  for each row execute function private.add_slack_member();

create trigger update_slack_profile
  after update of raw_user_meta_data on auth.users
  for each row execute function private.update_slack_profile();
