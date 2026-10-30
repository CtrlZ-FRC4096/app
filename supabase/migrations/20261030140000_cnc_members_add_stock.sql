-- Anyone on the team can add and change kinds of stock, not just mentors,
-- including adding them from the parts in Onshape. Deleting stock stays
-- with mentors.
--
-- This replaces rules from ..._cnc.sql. That migration is already merged,
-- so it isn't edited: this one swaps the rules instead.

drop policy "Mentors can add stock" on public.cnc_stock;
drop policy "Mentors can change stock" on public.cnc_stock;

create policy "Members can add stock"
  on public.cnc_stock for insert to authenticated
  with check ((select private.is_member()));

create policy "Members can change stock"
  on public.cnc_stock for update to authenticated
  using ((select private.is_member()))
  with check ((select private.is_member()));
