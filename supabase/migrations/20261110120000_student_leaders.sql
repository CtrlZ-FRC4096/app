-- Student leaders: a fourth role, between student and mentor.
--
-- A student leader gets mentor access to the parts of the app each
-- module chooses, using private.is_leader() below. Everything still
-- checked with private.is_mentor(), like attendance, stays with mentors
-- and admins. So until a module's own migration switches a rule to
-- is_leader(), a student leader can do just what a student can.
--
-- Admins make people student leaders in the Members module, the same way
-- they make people mentors. Only admins can change roles, as before.
--
-- This doesn't edit ..._members_and_slack_sign_in.sql, which is already
-- merged.

-- The role column only takes these. 'leader' is shown as "Student leader".
alter table public.members drop constraint members_role_check;
alter table public.members add constraint members_role_check
  check (role in ('student', 'leader', 'mentor', 'admin'));

-- True for student leaders, mentors and admins whose access is on.
create function private.is_leader()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.my_role() in ('leader', 'mentor', 'admin'), false)
$$;

revoke all on function private.is_leader() from public;
grant execute on function private.is_leader() to authenticated;
