-- Pit checklist: student leaders can now run the checklist, like mentors
-- and admins.
--
-- Who can do what now:
--   members                         read the items and every check
--   student leaders, mentors,       add, rename, assign, reorder and remove
--   admins                          items, and check or uncheck any item
--                                   (which is also how the list is cleared)
--   students                        check or uncheck only the items assigned
--                                   to them
--
-- private.is_leader() is from ..._student_leaders.sql: true for student
-- leaders, mentors and admins. This replaces the mentor rules from
-- ..._pit_checklist.sql. That migration is already merged, so it isn't
-- edited: this one swaps the rules instead.

-- Items
drop policy "Mentors can add pit checklist items as themselves" on public.pit_checklist_items;
drop policy "Mentors can rename, assign and reorder pit checklist items" on public.pit_checklist_items;
drop policy "Mentors can delete pit checklist items" on public.pit_checklist_items;

create policy "Leaders can add pit checklist items as themselves"
  on public.pit_checklist_items for insert to authenticated
  with check ((select private.is_leader()) and created_by = (select auth.uid()));

create policy "Leaders can rename, assign and reorder pit checklist items"
  on public.pit_checklist_items for update to authenticated
  using ((select private.is_leader()))
  with check ((select private.is_leader()));

create policy "Leaders can delete pit checklist items"
  on public.pit_checklist_items for delete to authenticated
  using ((select private.is_leader()));

-- Checks: students still only check and uncheck items assigned to them.
drop policy "Members can check their own items, and mentors any item" on public.pit_checklist_checks;
drop policy "Members can uncheck their own items, and mentors any item" on public.pit_checklist_checks;

create policy "Members can check their own items, and leaders any item"
  on public.pit_checklist_checks for insert to authenticated
  with check (
    (select private.is_member())
    and created_by = (select auth.uid())
    and (
      (select private.is_leader())
      or exists (
        select 1 from public.pit_checklist_items item
        where item.id = item_id and (select auth.uid()) = any (item.assignee_ids)
      )
    )
  );

create policy "Members can uncheck their own items, and leaders any item"
  on public.pit_checklist_checks for delete to authenticated
  using (
    (select private.is_member())
    and (
      (select private.is_leader())
      or exists (
        select 1 from public.pit_checklist_items item
        where item.id = item_id and (select auth.uid()) = any (item.assignee_ids)
      )
    )
  );
