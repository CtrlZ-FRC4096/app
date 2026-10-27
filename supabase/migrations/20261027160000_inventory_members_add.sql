-- Anyone on the team can add parts to Inventory, not just mentors. Changing
-- and deleting parts stays with mentors.
--
-- This replaces the add rule from ..._inventory_items.sql. That migration is
-- already merged, so it isn't edited: this one swaps the rule instead.

drop policy "Mentors can add parts as themselves" on public.inventory_items;

create policy "Members can add parts as themselves"
  on public.inventory_items for insert to authenticated
  with check ((select private.is_member()) and created_by = (select auth.uid()));
