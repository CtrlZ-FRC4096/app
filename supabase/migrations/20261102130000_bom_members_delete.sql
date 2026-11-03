-- Anyone on the team can now delete robots and systems too, so everyone can
-- edit the whole BOM. Deleting a robot deletes its systems, and deleting a
-- system deletes its parts and their stages.
--
-- This replaces the delete rules from ..._bom.sql, which
-- ..._bom_members_edit.sql kept for mentors. Both are already merged, so
-- neither is edited: this one swaps the rules instead.

drop policy "Mentors can delete robots" on public.bom_robots;
drop policy "Mentors can delete systems" on public.bom_systems;

create policy "Members can delete robots"
  on public.bom_robots for delete to authenticated
  using ((select private.is_member()));

create policy "Members can delete systems"
  on public.bom_systems for delete to authenticated
  using ((select private.is_member()));
