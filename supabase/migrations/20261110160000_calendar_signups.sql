-- The Calendar module's sign-ups: who's going to which event on the team
-- calendar, for events added from the app with sign-ups on. One row per
-- person per event. See src/modules/calendar/data.ts and issue #12.
--
-- The events themselves live in Google Calendar, not here, so event_id is
-- Google Calendar's id for the event. The database can't see Google
-- Calendar, so it can't check that the event takes sign-ups or hasn't
-- ended; the app checks those. What the database does keep safe: students
-- only sign themselves up, and only take back their own sign-up. Student
-- leaders, mentors and admins can sign anyone up and take anyone off.
--
-- Decided in #12: anyone on the team can sign up, there are no limits,
-- and everyone on the team can see who's signed up.
--
-- This runs after ..._student_leaders.sql, which makes private.is_leader().

create table public.calendar_signups (
  id uuid primary key default gen_random_uuid(),
  -- Google Calendar's event ids are letters, numbers, _ and - (see the
  -- calendar server function); the demo events' ids are too.
  event_id text not null check (char_length(event_id) between 1 and 1024 and event_id ~ '^[A-Za-z0-9_-]+$'),
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid() references public.members (id) on delete cascade,
  -- Nobody signs up twice for the same event.
  unique (event_id, created_by)
);

alter table public.calendar_signups enable row level security;

-- Signed-out visitors get nothing. Signed-in people get what the rules allow.
revoke all on table public.calendar_signups from anon, authenticated;
grant select, insert, delete on table public.calendar_signups to authenticated;

-- New sign-ups show up for everyone straight away.
alter publication supabase_realtime add table public.calendar_signups;

create policy "Members can see who's signed up"
  on public.calendar_signups for select to authenticated
  using ((select private.is_member()));

create policy "Members sign themselves up, and leaders sign anyone up"
  on public.calendar_signups for insert to authenticated
  with check (
    ((select private.is_member()) and created_by = (select auth.uid()))
    or (select private.is_leader())
  );

create policy "Members take back their own sign-up, and leaders anyone's"
  on public.calendar_signups for delete to authenticated
  using (
    ((select private.is_member()) and created_by = (select auth.uid()))
    or (select private.is_leader())
  );

-- No update rule, so a sign-up can't be moved to another event or person.
-- To change your mind, take it back and sign up again.
