-- The Inventory module's table: the parts the team keeps, where they live
-- and how many are left.
--
-- Copied from ..._example_notes.sql. Taking and adding stock isn't here yet:
-- that comes with its own rules in a later migration (issue #2).

create table public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 100),
  vendor text not null check (char_length(vendor) between 1 and 60),
  vendor_part_number text not null check (char_length(vendor_part_number) between 1 and 60),
  -- A bin or shelf, like "Bin E2".
  location text not null check (char_length(location) between 1 and 60),
  quantity integer not null default 0 check (quantity >= 0),
  low_stock_level integer not null default 0 check (low_stock_level >= 0),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.members (id) on delete set null,
  -- The BOM finds a part by its vendor and part number, so each pair is listed once.
  unique (vendor, vendor_part_number)
);

alter table public.inventory_items enable row level security;

-- Signed-out visitors get nothing. Signed-in people get what the rules allow.
revoke all on table public.inventory_items from anon, authenticated;
grant select, insert, update, delete on table public.inventory_items to authenticated;

-- Changes from other people show up in the app straight away.
alter publication supabase_realtime add table public.inventory_items;

-- The rules. Wrapping the helpers in (select ...) lets the database work out
-- the answer once per query instead of once per row.

create policy "Members can read parts"
  on public.inventory_items for select to authenticated
  using ((select private.is_member()));

create policy "Mentors can add parts as themselves"
  on public.inventory_items for insert to authenticated
  with check ((select private.is_mentor()) and created_by = (select auth.uid()));

create policy "Mentors can change parts"
  on public.inventory_items for update to authenticated
  using ((select private.is_mentor()))
  with check ((select private.is_mentor()));

create policy "Mentors can remove parts"
  on public.inventory_items for delete to authenticated
  using ((select private.is_mentor()));
