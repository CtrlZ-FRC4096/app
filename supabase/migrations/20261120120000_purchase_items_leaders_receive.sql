-- Purchasing: student leaders can mark an order as Received, and put it
-- in the shop.
--
-- Student leaders are often the ones in the shop when a box turns up, but
-- only mentors and purchasers could say so, so arrived orders stayed at
-- Order Placed. Now a student leader can move an order:
--
--   on its way (Order Placed, Out of Stock or Backordered) -> Received
--   Received                                                -> In Shop
--
-- Those two steps are all they gain. A student leader still can't place or
-- cancel an order, skip straight to In Shop, move one back, or change
-- anything else about an order. Students who aren't leaders can't do any
-- of it, as before. (Adding what arrived to Inventory needs no new rule:
-- anyone on the team can already add parts and stock.)
--
-- This replaces the check from ..._purchase_items_ordered_tracking.sql
-- (already merged). The only differences are the `leader_step` line and
-- where it's used. private.is_leader() is from ..._student_leaders.sql: it's true
-- for student leaders, mentors and admins.

create or replace function private.check_purchase_order()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- A student leader saying an order arrived, or that it's put away.
  leader_step boolean := false;
begin
  if auth.uid() is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if (private.is_order(new.status) or new.shipped_to is not null or new.ordered_by is not null
        or new.estimated_arrival is not null or new.ordered_on is not null or new.tracking is not null)
       and not private.is_purchaser() then
      raise exception 'permission denied: only mentors and purchasers can place orders'
        using errcode = '42501';
    end if;
    if new.status = 'placed' and new.ordered_by is null then
      new.ordered_by := auth.uid();
    end if;
    return new;
  end if;

  leader_step := private.is_leader() and (
    (old.status in ('placed', 'out_of_stock', 'backordered') and new.status = 'received')
    or (old.status = 'received' and new.status = 'in_shop'));

  if ((new.status is distinct from old.status and (private.is_order(old.status) or private.is_order(new.status)) and not leader_step)
      or new.shipped_to is distinct from old.shipped_to
      or new.ordered_by is distinct from old.ordered_by
      or new.estimated_arrival is distinct from old.estimated_arrival
      or new.ordered_on is distinct from old.ordered_on
      or new.tracking is distinct from old.tracking
      or (private.is_order(old.status) and (
            new.name is distinct from old.name
            or new.vendor is distinct from old.vendor
            or new.type is distinct from old.type
            or new.link is distinct from old.link
            or new.part_number is distinct from old.part_number
            or new.quantity is distinct from old.quantity
            or new.notes is distinct from old.notes
            or new.price is distinct from old.price)))
     and not private.is_purchaser() then
    raise exception 'permission denied: only mentors and purchasers can change orders'
      using errcode = '42501';
  end if;
  -- Placing an order: whoever places it, unless they picked someone else.
  if new.status = 'placed' and old.status is distinct from 'placed' and new.ordered_by is not distinct from old.ordered_by then
    new.ordered_by := auth.uid();
  end if;
  return new;
end;
$$;
