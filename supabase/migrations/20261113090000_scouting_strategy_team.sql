-- The strategy team (#167). From the scouting requirements: "Give strategy
-- people ability to access overview (SPECIFICALLY ONLY STRAT PEOPLE AND ALL
-- MENTORS)."
--
-- Like purchasers (purchasing_buyers), being on the strategy team is an
-- extra permission on top of someone's role, so a student can be on it.
-- Mentors and admins choose who, on the Members page, and always count as
-- strategy.
--
-- Strategy only: the scouting overview, team pages, picklists, simulator,
-- stats and prescouting. Everyone: the match and pit forms, the schedule and
-- the rankings, so any scout can do their job.
--
-- Hiding pages isn't security, so the read rules on the tables behind the
-- strategy pages change here too. Scouts can still send their own match and
-- pit entries and read them back.

create table public.scouting_strategy_team (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null unique references public.members (id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.members (id) on delete set null
);

alter table public.scouting_strategy_team enable row level security;

revoke all on table public.scouting_strategy_team from anon, authenticated;
grant select, insert, delete on table public.scouting_strategy_team to authenticated;

alter publication supabase_realtime add table public.scouting_strategy_team;

-- Everyone sees who's on the strategy team, so the app knows what to show.
create policy "Members can read the strategy team"
  on public.scouting_strategy_team for select to authenticated
  using ((select private.is_member()));

create policy "Mentors add people to the strategy team"
  on public.scouting_strategy_team for insert to authenticated
  with check ((select private.is_mentor()) and created_by = (select auth.uid()));

create policy "Mentors take people off the strategy team"
  on public.scouting_strategy_team for delete to authenticated
  using ((select private.is_mentor()));

-- True for mentors, admins and strategy team members whose access is on.
create function private.is_strategy()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_mentor()
    or (private.is_member() and exists (select 1 from public.scouting_strategy_team where member_id = auth.uid()))
$$;

grant execute on function private.is_strategy() to authenticated;

-- Match and pit entries: the strategy team reads every one; anyone else
-- reads only the ones they scouted or sent.
drop policy "Members can read scouting entries" on public.scouting_entries;
create policy "Strategy reads every entry, scouts their own"
  on public.scouting_entries for select to authenticated
  using (
    (select private.is_strategy())
    or ((select private.is_member()) and (created_by = (select auth.uid()) or scouted_by = (select auth.uid())))
  );

drop policy "Members can read pit entries" on public.scouting_pit_entries;
create policy "Strategy reads every pit entry, scouts their own"
  on public.scouting_pit_entries for select to authenticated
  using (
    (select private.is_strategy())
    or ((select private.is_member()) and (created_by = (select auth.uid()) or scouted_by = (select auth.uid())))
  );

-- The final picklist: the strategy team only. (Only mentors change it, as before.)
drop policy "Members can read the picklist" on public.scouting_picklist;
create policy "Strategy reads the picklist"
  on public.scouting_picklist for select to authenticated
  using ((select private.is_strategy()));

-- Prescouting notes: the whole Prescouting module is strategy only, so the
-- strategy team reads, adds and changes them. Only mentors delete, as before.
drop policy "Members can read prescouting" on public.prescouting_notes;
create policy "Strategy reads prescouting"
  on public.prescouting_notes for select to authenticated
  using ((select private.is_strategy()));

drop policy "Members can add prescouting as themselves" on public.prescouting_notes;
create policy "Strategy adds prescouting as themselves"
  on public.prescouting_notes for insert to authenticated
  with check ((select private.is_strategy()) and created_by = (select auth.uid()));

drop policy "Members can change prescouting" on public.prescouting_notes;
create policy "Strategy changes prescouting"
  on public.prescouting_notes for update to authenticated
  using ((select private.is_strategy()))
  with check ((select private.is_strategy()));
