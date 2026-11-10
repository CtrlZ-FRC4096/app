-- BOM: who can do what, now that there are student leaders.
--
-- Anyone on the team can still:
--   - add and change systems
--   - choose a part's stages, and move stages along (bom_steps: unchanged)
--
-- Only student leaders, mentors and admins can now:
--   - add, rename and delete robots
--   - add, change and delete parts, which includes importing from Onshape
--   - delete a system, which deletes every part in it too
--
-- private.is_leader() is from ..._student_leaders.sql. This replaces rules
-- from ..._bom.sql and ..._bom_members_edit.sql. Those migrations are
-- already merged, so they aren't edited: this one swaps the rules instead.
-- Which columns can be changed (..._bom_members_edit.sql) stays the same.

-- Robots
drop policy "Members can add robots as themselves" on public.bom_robots;
drop policy "Members can change robots" on public.bom_robots;
drop policy "Mentors can delete robots" on public.bom_robots;

create policy "Leaders can add robots as themselves"
  on public.bom_robots for insert to authenticated
  with check ((select private.is_leader()) and created_by = (select auth.uid()));

create policy "Leaders can change robots"
  on public.bom_robots for update to authenticated
  using ((select private.is_leader()))
  with check ((select private.is_leader()));

create policy "Leaders can delete robots"
  on public.bom_robots for delete to authenticated
  using ((select private.is_leader()));

-- Systems: anyone on the team still adds and changes them.
drop policy "Mentors can delete systems" on public.bom_systems;

create policy "Leaders can delete systems"
  on public.bom_systems for delete to authenticated
  using ((select private.is_leader()));

-- Parts
drop policy "Members can add parts as themselves" on public.bom_parts;
drop policy "Members can change parts" on public.bom_parts;
drop policy "Members can delete parts" on public.bom_parts;

create policy "Leaders can add parts as themselves"
  on public.bom_parts for insert to authenticated
  with check ((select private.is_leader()) and created_by = (select auth.uid()));

create policy "Leaders can change parts"
  on public.bom_parts for update to authenticated
  using ((select private.is_leader()))
  with check ((select private.is_leader()));

create policy "Leaders can delete parts"
  on public.bom_parts for delete to authenticated
  using ((select private.is_leader()));
