-- Required Mondays: students must come to the Monday meetings on the team
-- calendar. The meetings themselves come from Google Calendar (the calendar
-- server function), so they aren't stored here. These two tables hold what
-- the calendar can't:
--
--   attendance_not_required  Mondays a mentor has said aren't required,
--                            like a holiday that's still on the calendar.
--   attendance_absences      "I can't make it" from a student, with a
--                            reason. Any absence sent counts as excused:
--                            nobody approves it. Mentors see when it was
--                            sent, so one sent after the meeting stands out.
--                            Mentors and admins don't send them.
--
-- Whether someone came is their Jibble check-ins (attendance_checks), so
-- nothing here changes hours or points.

create table public.attendance_not_required (
  id uuid primary key default gen_random_uuid(),
  -- The Monday that isn't required.
  day date not null unique,
  -- Why, like "MLK Day, no meeting". Optional.
  reason text not null default '' check (char_length(reason) <= 200),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.members (id) on delete set null
);

alter table public.attendance_not_required enable row level security;

revoke all on table public.attendance_not_required from anon, authenticated;
grant select, delete on table public.attendance_not_required to authenticated;
grant insert (day, reason) on table public.attendance_not_required to authenticated;

alter publication supabase_realtime add table public.attendance_not_required;

-- Everyone on the team can see which Mondays aren't required, so students
-- know when they don't have to come.
create policy "Members see which Mondays aren't required"
  on public.attendance_not_required for select to authenticated
  using ((select private.is_member()));

create policy "Mentors mark Mondays not required"
  on public.attendance_not_required for insert to authenticated
  with check ((select private.is_mentor()));

create policy "Mentors make Mondays required again"
  on public.attendance_not_required for delete to authenticated
  using ((select private.is_mentor()));

create table public.attendance_absences (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.attendance_people (id) on delete cascade,
  -- The meeting day they'll miss (or missed).
  day date not null,
  -- Why, for the mentors.
  reason text not null check (char_length(trim(reason)) between 1 and 300),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.members (id) on delete set null,
  -- One per person per day: to change the reason, take it back and send it again.
  unique (person_id, day)
);

alter table public.attendance_absences enable row level security;

-- People only ever write who, which day and why. There's nothing to approve,
-- so nobody updates a row: take it back and send it again instead.
revoke all on table public.attendance_absences from anon, authenticated;
grant select, delete on table public.attendance_absences to authenticated;
grant insert (person_id, day, reason) on table public.attendance_absences to authenticated;

alter publication supabase_realtime add table public.attendance_absences;

-- Mentors and admins see and remove everyone's, but don't send any: the
-- Mondays are required for students, not for them.
create policy "Mentors see every absence"
  on public.attendance_absences for select to authenticated
  using ((select private.is_mentor()));

create policy "Mentors remove any absence"
  on public.attendance_absences for delete to authenticated
  using ((select private.is_mentor()));

-- Everyone else: only their own (matched by Slack account, see
-- private.my_attendance_people() in the own stats migration).
create policy "Members see their own absences"
  on public.attendance_absences for select to authenticated
  using (person_id in (select private.my_attendance_people()));

create policy "Students and student leaders say they can't make it"
  on public.attendance_absences for insert to authenticated
  with check (person_id in (select private.my_attendance_people()) and not (select private.is_mentor()));

create policy "Members take back their own absences"
  on public.attendance_absences for delete to authenticated
  using (person_id in (select private.my_attendance_people()));
