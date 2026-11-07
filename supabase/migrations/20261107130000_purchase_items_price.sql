-- Purchasing: what one of an item costs.
--
-- A mentor decided how this works:
--
--   - Everyone on the team can see prices. They're public on vendors' sites,
--     so this is a plain column, not a mentors-only table.
--   - It's the price of ONE item. The app works out the line's total from
--     the price and the number needed, so the two can't disagree.
--   - Anyone can fill it in or change it while an item is being asked for.
--     Once it's ordered (Order Placed or after), only mentors and purchasers
--     can change it, because by then it's what the team really paid.
--   - In fact the whole item locks at that point. Once it's ordered,
--     students can't change anything about it: its name, vendor, type,
--     link, part number, number needed, notes or price. Mentors and
--     purchasers still can. (Its status and order details were already
--     locked.)
--
-- It can be empty: people don't always know the price when they ask. Zero is
-- allowed, for something free.
--
-- This replaces the check from ..._purchase_items_estimated_arrival.sql
-- (already merged) with one that also locks ordered items. Everything else
-- in it is the same.
--
-- It names the columns people can change rather than comparing the whole
-- row, so the database can still clear bom_part_id when a BOM part is
-- deleted.

alter table public.purchase_items
  add column price numeric(7, 2) check (price >= 0);

-- Anyone may send it; the check below refuses a change to an order from
-- anyone but a mentor or purchaser.
grant update (price) on table public.purchase_items to authenticated;

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
        or new.estimated_arrival is not null)
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
