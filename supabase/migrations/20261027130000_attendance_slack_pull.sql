-- The automatic daily pull from the attendance channel in Slack.
--
-- The "Pull attendance from Slack" workflow reads the channel with the
-- Slack bot and calls private.import_attendance with what it found. The
-- function adds only what's new, the same way importing an export by hand
-- does:
--   - people are matched by Slack ID (or by name, for Jibble names that
--     matched no Slack account)
--   - a check-in already there is skipped, including one a mentor ignored
--   - poll answers are updated, except ones a mentor set by hand
-- Each pull is logged in attendance_syncs, so the app can say when the
-- data was last pulled.

create table public.attendance_syncs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  -- The newest Slack message this pull read. The next pull starts a little before it.
  newest_message_at timestamptz,
  people_added integer not null default 0,
  checks_added integer not null default 0,
  rsvps_changed integer not null default 0
);

alter table public.attendance_syncs enable row level security;
revoke all on table public.attendance_syncs from anon, authenticated;
grant select on table public.attendance_syncs to authenticated;
alter publication supabase_realtime add table public.attendance_syncs;

create policy "Mentors can see when attendance was last pulled"
  on public.attendance_syncs for select to authenticated
  using ((select private.is_mentor()));

-- Only the workflow (connecting as the database owner) runs this.
create function private.import_attendance(payload jsonb)
returns public.attendance_syncs
language plpgsql
security definer
set search_path = ''
as $$
declare
  people_added integer;
  named_added integer;
  checks_added integer;
  rsvps_changed integer;
  result public.attendance_syncs;
begin
  with added as (
    insert into public.attendance_people (slack_user_id, name)
    select distinct on (p ->> 'slack_user_id') p ->> 'slack_user_id', trim(p ->> 'name')
    from jsonb_array_elements(coalesce(payload -> 'people', '[]')) p
    where p ->> 'slack_user_id' is not null
    on conflict (slack_user_id) do nothing
    returning 1
  )
  select count(*) into people_added from added;

  with added as (
    insert into public.attendance_people (name)
    select distinct on (lower(trim(p ->> 'name'))) trim(p ->> 'name')
    from jsonb_array_elements(coalesce(payload -> 'people', '[]')) p
    where p ->> 'slack_user_id' is null
      and not exists (
        select 1 from public.attendance_people a
        where a.slack_user_id is null and lower(a.name) = lower(trim(p ->> 'name'))
      )
    returning 1
  )
  select count(*) into named_added from added;

  with added as (
    insert into public.attendance_checks (person_id, direction, at, source)
    select person.id, c ->> 'direction', (c ->> 'at')::timestamptz, 'jibble'
    from jsonb_array_elements(coalesce(payload -> 'checks', '[]')) c
    cross join lateral (
      select a.id from public.attendance_people a
      where (c ->> 'slack_user_id' is not null and a.slack_user_id = c ->> 'slack_user_id')
         or (c ->> 'slack_user_id' is null and a.slack_user_id is null and lower(a.name) = lower(trim(c ->> 'name')))
      limit 1
    ) person
    on conflict (person_id, direction, at) do nothing
    returning 1
  )
  select count(*) into checks_added from added;

  with changed as (
    insert into public.attendance_rsvps (person_id, day, coming, source)
    select distinct on (a.id, (r ->> 'day')::date) a.id, (r ->> 'day')::date, (r ->> 'coming')::boolean, 'poll'
    from jsonb_array_elements(coalesce(payload -> 'rsvps', '[]')) r
    join public.attendance_people a on a.slack_user_id = r ->> 'slack_user_id'
    on conflict (person_id, day) do update set coming = excluded.coming
      where public.attendance_rsvps.source = 'poll' and public.attendance_rsvps.coming <> excluded.coming
    returning 1
  )
  select count(*) into rsvps_changed from changed;

  insert into public.attendance_syncs (newest_message_at, people_added, checks_added, rsvps_changed)
  values (nullif(payload ->> 'newest_message_at', '')::timestamptz, people_added + named_added, checks_added, rsvps_changed)
  returning * into result;
  return result;
end;
$$;

revoke all on function private.import_attendance(jsonb) from public;
