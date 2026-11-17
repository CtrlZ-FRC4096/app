-- Purchasing: when an item was ordered, and its tracking number (#66).
--
-- Once something is ordered, the team keeps asking "when did we order it?"
-- and "where is it?". Like Ordered by, Shipped to and Estimated arrival,
-- only mentors and purchasers can set or change these two. Everyone on the
-- team can see them.
--
--   ordered_on   the date it was ordered. Empty until it's ordered. The app
--                fills in today's date when someone picks Order Placed, and
--                they can change it.
--   tracking     the shipping company's tracking number. Empty if there
--                isn't one.
--
-- This replaces the check from ..._purchase_items_price.sql (already
-- merged) with one that also covers ordered_on and tracking. It names the
-- columns people can change, so a new column isn't covered until it's
-- added here. Everything else in it is the same.

alter table public.purchase_items
  add column ordered_on date,
  add column tracking text check (char_length(tracking) between 1 and 200);

-- Anyone may send them; the check below refuses a change from anyone but a
-- mentor or purchaser.
grant update (ordered_on, tracking) on table public.purchase_items to authenticated;

create or replace function private.check_purchase_order()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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

  if ((new.status is distinct from old.status and (private.is_order(old.status) or private.is_order(new.status)))
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
