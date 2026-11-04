-- Purchasing: purchasers, Ordered by and Shipped to (#78).
--
-- Anyone on the team still asks for things, and changes the priority of
-- what's being asked for (Wait to Order and the three Order statuses).
-- Placing, cancelling and following up orders is for mentors and the
-- team's purchasers:
--
--   - moving an item into or out of Order Placed, Out of Stock,
--     Backordered, Received, In Shop or Cancel Item
--   - setting Shipped to (who the package goes to)
--   - changing Ordered by
--   - deleting an item that isn't just being asked for
--
-- Ordered by is filled in by the database with whoever moves an item to
-- Order Placed, unless they pick someone else as they do it. After that,
-- mentors and purchasers can change it.
--
-- This doesn't edit ..._purchase_items.sql, which is already merged.

-- The team's purchasers. Mentors and admins can always do what purchasers do.
create table public.purchasing_buyers (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null unique references public.members (id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.members (id) on delete set null
);

alter table public.purchasing_buyers enable row level security;

revoke all on table public.purchasing_buyers from anon, authenticated;
grant select, insert, delete on table public.purchasing_buyers to authenticated;

alter publication supabase_realtime add table public.purchasing_buyers;

-- Everyone sees who the purchasers are, so they know who to ask.
create policy "Members can read purchasers"
  on public.purchasing_buyers for select to authenticated
  using ((select private.is_member()));

create policy "Mentors add purchasers"
  on public.purchasing_buyers for insert to authenticated
  with check ((select private.is_mentor()) and created_by = (select auth.uid()));

create policy "Mentors remove purchasers"
  on public.purchasing_buyers for delete to authenticated
  using ((select private.is_mentor()));

-- True for mentors, admins and purchasers whose access is on.
create function private.is_purchaser()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_mentor()
    or (private.is_member() and exists (select 1 from public.purchasing_buyers where member_id = auth.uid()))
$$;

-- The statuses of something still being asked for.
create function private.is_asking(status text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select status in ('wait', 'order_low', 'order', 'order_high')
$$;

-- The statuses of an order. (Anything else isn't a status: the check on
-- the status column refuses it.)
create function private.is_order(status text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select status in ('placed', 'out_of_stock', 'backordered', 'received', 'in_shop', 'cancelled')
$$;

grant execute on function private.is_purchaser(), private.is_asking(text), private.is_order(text) to authenticated;

alter table public.purchase_items
  add column ordered_by uuid references public.members (id) on delete set null,
  add column shipped_to uuid references public.members (id) on delete set null;

-- Anyone may send these; the check below refuses a change from anyone but
-- a mentor or purchaser.
grant update (ordered_by, shipped_to) on table public.purchase_items to authenticated;

-- Refuse order changes from anyone but mentors and purchasers, and fill in
-- Ordered by. The database owner (the SQL editor, server functions) has no
-- auth.uid() and isn't limited.
create function private.check_purchase_order()
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
    if (private.is_order(new.status) or new.shipped_to is not null or new.ordered_by is not null)
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
      or new.ordered_by is distinct from old.ordered_by)
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

create trigger check_purchase_order
  before insert or update on public.purchase_items
  for each row execute function private.check_purchase_order();

-- Students can still delete something that's only being asked for, but not an order.
drop policy "Members can delete purchase items" on public.purchase_items;

create policy "Members delete requests, and mentors and purchasers delete orders"
  on public.purchase_items for delete to authenticated
  using (
    (select private.is_purchaser())
    or ((select private.is_member()) and private.is_asking(status))
  );
