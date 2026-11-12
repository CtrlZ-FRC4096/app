-- The roster now lists everyone in attendance (from the Slack channel and
-- Jibble), not only people who have signed in to the app: someone whose
-- Jibble name matched no Slack account, or who has never opened the app,
-- can still be marked active and put on subteams. So roster rows point at
-- attendance_people instead of members.
--
-- Rows mentors already set are kept: each member is matched to their
-- attendance row by Slack account, and a member with no attendance row yet
-- gets one, the same way the nightly pull from Slack adds people.

alter table public.roster_students add column person_id uuid references public.attendance_people (id) on delete cascade;
alter table public.roster_subteam_members add column person_id uuid references public.attendance_people (id) on delete cascade;

insert into public.attendance_people (slack_user_id, name)
select m.slack_user_id, m.name
from public.members m
where m.id in (select member_id from public.roster_students union select member_id from public.roster_subteam_members)
  and not exists (select 1 from public.attendance_people p where p.slack_user_id = m.slack_user_id);

update public.roster_students r
set person_id = p.id
from public.members m
join public.attendance_people p on p.slack_user_id = m.slack_user_id
where m.id = r.member_id;

update public.roster_subteam_members r
set person_id = p.id
from public.members m
join public.attendance_people p on p.slack_user_id = m.slack_user_id
where m.id = r.member_id;

-- The old rules and the one-main-subteam index name member_id: replace them.
drop policy "Members see whether they're active" on public.roster_students;
drop policy "Members see their own subteams" on public.roster_subteam_members;
drop index public.roster_one_main_subteam;

-- Dropping member_id also drops its unique constraints and column grants.
alter table public.roster_students drop column member_id;
alter table public.roster_subteam_members drop column member_id;

alter table public.roster_students alter column person_id set not null, add unique (person_id);
alter table public.roster_subteam_members alter column person_id set not null, add unique (person_id, subteam_id);
create unique index roster_one_main_subteam on public.roster_subteam_members (person_id) where main;

grant insert (person_id, active) on table public.roster_students to authenticated;
grant insert (person_id, subteam_id, main) on table public.roster_subteam_members to authenticated;

-- Everyone else still sees only their own entry: their attendance row,
-- matched by Slack account (private.my_attendance_people(), from the
-- attendance own stats migration), while their access is on.
create policy "Members see whether they're active"
  on public.roster_students for select to authenticated
  using (person_id in (select private.my_attendance_people()));

create policy "Members see their own subteams"
  on public.roster_subteam_members for select to authenticated
  using (person_id in (select private.my_attendance_people()));
