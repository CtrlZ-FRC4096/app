-- Anyone on the team can build the BOM, not just mentors: add and change
-- robots and systems, and add, change and delete parts. Deleting a robot or
-- a system stays with mentors, because it deletes every part in it too.
--
-- This replaces rules from ..._bom.sql. That migration is already merged,
-- so it isn't edited: this one swaps the rules instead.

-- Robots
drop policy "Mentors can add robots" on public.bom_robots;
drop policy "Mentors can change robots" on public.bom_robots;

create policy "Members can add robots as themselves"
  on public.bom_robots for insert to authenticated
  with check ((select private.is_member()) and created_by = (select auth.uid()));

create policy "Members can change robots"
  on public.bom_robots for update to authenticated
  using ((select private.is_member()))
  with check ((select private.is_member()));

-- Systems
drop policy "Mentors can add systems" on public.bom_systems;
drop policy "Mentors can change systems" on public.bom_systems;

create policy "Members can add systems as themselves"
  on public.bom_systems for insert to authenticated
  with check ((select private.is_member()) and created_by = (select auth.uid()));

create policy "Members can change systems"
  on public.bom_systems for update to authenticated
  using ((select private.is_member()))
  with check ((select private.is_member()));

-- Parts
drop policy "Mentors can change parts" on public.bom_parts;
drop policy "Mentors can delete parts" on public.bom_parts;

create policy "Members can change parts"
  on public.bom_parts for update to authenticated
  using ((select private.is_member()))
  with check ((select private.is_member()));

create policy "Members can delete parts"
  on public.bom_parts for delete to authenticated
  using ((select private.is_member()));

-- Changing a row can't change who made it or when, or move it to another
-- robot or system: only these columns can be updated.
revoke update on table public.bom_robots, public.bom_systems, public.bom_parts from authenticated;
grant update (name) on table public.bom_robots to authenticated;
grant update (name, code, onshape_url) on table public.bom_systems to authenticated;
grant update (part_number, name, revision, kind, material, quantity, vendor, vendor_part_number, onshape_url)
  on table public.bom_parts to authenticated;
