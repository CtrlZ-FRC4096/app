-- The Purchasing module's table: what the team needs to buy, from asking
-- for it to it being in the shop. It replaces the "BOM List" in Slack's
-- build parts channel, and has the same columns. Order details (dates,
-- tracking, who ordered), prices and receipts come in later steps (#66).
--
-- This list is typed in by hand. It's separate from the BOM, which comes
-- from Onshape.
--
-- Like the Slack list, anyone on the team can add, change and delete any
-- item. People who aren't signed in, or whose access is off, get nothing.
--
-- The helper private.is_member() comes from the members migration.

create table public.purchase_items (
  id uuid primary key default gen_random_uuid(),
  -- What to buy, like "Ethernet Cables 5 ft 10 pack".
  name text not null check (char_length(trim(name)) between 1 and 200),
  -- The statuses are listed, in order, in src/modules/purchasing/data.ts.
  -- Adding one means changing this check in a new migration too.
  status text not null default 'order' check (status in (
    'wait', 'order_low', 'order', 'order_high', 'placed',
    'out_of_stock', 'backordered', 'received', 'in_shop', 'cancelled'
  )),
  -- Vendors and types are picked from lists in data.ts. The database only
  -- checks their length, so the lists can change without a migration.
  vendor text not null check (char_length(vendor) between 1 and 100),
  type text not null check (char_length(type) between 1 and 100),
  -- Only https:// links, so a link can't run code when someone opens it.
  -- Shop links can be long.
  link text check (link like 'https://%' and char_length(link) <= 2000),
  part_number text check (char_length(part_number) between 1 and 100),
  quantity integer not null check (quantity between 1 and 10000),
  -- Who asked for it. Usually whoever added it; an import from Slack can
  -- set someone else.
  requested_by uuid default auth.uid() references public.members (id) on delete set null,
  notes text check (char_length(notes) between 1 and 1000),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.members (id) on delete set null
);

create index on public.purchase_items (status);

alter table public.purchase_items enable row level security;

-- Signed-out visitors get nothing. Signed-in people can't change who added
-- an item or when.
revoke all on table public.purchase_items from anon, authenticated;
grant select, insert, delete on table public.purchase_items to authenticated;
grant update (name, status, vendor, type, link, part_number, quantity, requested_by, notes) on table public.purchase_items to authenticated;

-- Changes from other people show up in the app straight away.
alter publication supabase_realtime add table public.purchase_items;

-- The rules. Wrapping the helpers in (select ...) lets the database work out
-- the answer once per query instead of once per row.

create policy "Members can read purchase items"
  on public.purchase_items for select to authenticated
  using ((select private.is_member()));

create policy "Members can add purchase items as themselves"
  on public.purchase_items for insert to authenticated
  with check ((select private.is_member()) and created_by = (select auth.uid()));

create policy "Members can change purchase items"
  on public.purchase_items for update to authenticated
  using ((select private.is_member()))
  with check ((select private.is_member()));

create policy "Members can delete purchase items"
  on public.purchase_items for delete to authenticated
  using ((select private.is_member()));
