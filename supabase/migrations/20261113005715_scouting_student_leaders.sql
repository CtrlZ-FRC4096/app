-- Give student leaders the same Scouting and Prescouting permissions as
-- mentors and admins (mentor-approved).
--
-- The policy names use Leaders for the existing private.is_leader() helper:
-- student leaders, mentors and admins. Ordinary students keep their existing
-- permissions, and other modules are unchanged. The existing safeguards on
-- who created a row, and on which columns can change, stay exactly the same.
--
-- Do not edit the earlier migrations: the team database has already run them.
-- Replace only these policies, in one transaction so nobody sees a mix of
-- old and new permissions.

begin;

-- Match entries: change and delete.
drop policy "Mentors can change scouting entries" on public.scouting_entries;
create policy "Leaders can change scouting entries"
  on public.scouting_entries for update to authenticated
  using ((select private.is_leader()))
  with check ((select private.is_leader()));

drop policy "Mentors can delete scouting entries" on public.scouting_entries;
create policy "Leaders can delete scouting entries"
  on public.scouting_entries for delete to authenticated
  using ((select private.is_leader()));

-- Pit entries: change and delete.
drop policy "Mentors can change pit entries" on public.scouting_pit_entries;
create policy "Leaders can change pit entries"
  on public.scouting_pit_entries for update to authenticated
  using ((select private.is_leader()))
  with check ((select private.is_leader()));

drop policy "Mentors can delete pit entries" on public.scouting_pit_entries;
create policy "Leaders can delete pit entries"
  on public.scouting_pit_entries for delete to authenticated
  using ((select private.is_leader()));

-- Prescouting: delete notes. Everyone on the team can already add and change them.
drop policy "Mentors can delete prescouting" on public.prescouting_notes;
create policy "Leaders can delete prescouting"
  on public.prescouting_notes for delete to authenticated
  using ((select private.is_leader()));

-- Shared picklist: add, move, mark and remove teams, still under the creator
-- and permitted-columns safeguards from the original migration.
drop policy "Mentors can add teams to the picklist as themselves" on public.scouting_picklist;
create policy "Leaders can add teams to the picklist as themselves"
  on public.scouting_picklist for insert to authenticated
  with check ((select private.is_leader()) and created_by = (select auth.uid()));

drop policy "Mentors can move and mark teams on the picklist" on public.scouting_picklist;
create policy "Leaders can move and mark teams on the picklist"
  on public.scouting_picklist for update to authenticated
  using ((select private.is_leader()))
  with check ((select private.is_leader()));

drop policy "Mentors can take teams off the picklist" on public.scouting_picklist;
create policy "Leaders can take teams off the picklist"
  on public.scouting_picklist for delete to authenticated
  using ((select private.is_leader()));

-- The event: add a pick. Picks remain append-only for everyone.
drop policy "Mentors can pick the event, as themselves" on public.scouting_events;
create policy "Leaders can pick the event, as themselves"
  on public.scouting_events for insert to authenticated
  with check ((select private.is_leader()) and created_by = (select auth.uid()));

commit;
