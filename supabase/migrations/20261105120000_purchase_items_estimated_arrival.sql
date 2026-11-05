-- Purchasing: when an order should arrive.
--
-- Whoever places an order sets its estimated arrival, so like Ordered by
-- and Shipped to, only mentors and purchasers can set or change it. The
-- app shows "Arrives Nov 12", and Late once the date has passed and the
-- order still hasn't been received.
--
-- This replaces the check from ..._purchasing_orders.sql (already merged)
-- with one that also covers estimated_arrival. Everything else in it is
-- the same.

alter table public.purchase_items
  add column estimated_arrival date;

-- Anyone may send it; the check below refuses a change from anyone but a
-- mentor or purchaser.
grant update (estimated_arrival) on table public.purchase_items to authenticated;

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
      or new.estimated_arrival is distinct from old.estimated_arrival)
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
