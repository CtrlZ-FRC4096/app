-- Everyone on the team can see their own attendance: their points, hours
-- and the days behind them. Nobody else's: that stays mentors and admins
-- only (see the attendance migration).
--
-- People are matched by their Slack account: the attendance row with the
-- same Slack user ID as their member row. Someone added by name only (a
-- Jibble name that matched no Slack account) isn't matched, so only
-- mentors see them.
--
-- These rules only let people read. Changing anything is still mentors only.

-- The attendance people rows that are the signed-in person's, if their
-- access is on. Runs with the owner's rights (security definer) so it can
-- read both tables without going through their rules.
create function private.my_attendance_people()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id
  from public.attendance_people p
  join public.members m on m.slack_user_id = p.slack_user_id
  where m.id = auth.uid() and m.active
$$;

grant execute on function private.my_attendance_people() to authenticated;

create policy "Members see their own attendance person"
  on public.attendance_people for select to authenticated
  using (id in (select private.my_attendance_people()));

create policy "Members see their own check-ins"
  on public.attendance_checks for select to authenticated
  using (person_id in (select private.my_attendance_people()));

create policy "Members see their own RSVPs"
  on public.attendance_rsvps for select to authenticated
  using (person_id in (select private.my_attendance_people()));

-- The dates points are counted over, like "2027 build season", so people
-- see their points for the same dates mentors do. Just names and dates.
create policy "Members see the points periods"
  on public.attendance_periods for select to authenticated
  using ((select private.is_member()));
