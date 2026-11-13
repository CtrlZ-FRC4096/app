-- The BOM's catalog of bought (COTS) parts (issue #20): one entry per part
-- a vendor sells, with its name and a link to buy it. The team fills it in
-- once and reuses it every season, so a COTS line in the BOM with the same
-- vendor part number shows the catalog's name and link.
--
-- Prices aren't here: they go in a mentor-only prices table later (#17),
-- because students can read this one.
--
-- Everyone on the team can read the catalog. Adding, changing and deleting
-- entries is the same as parts: student leaders, mentors and admins
-- (private.is_leader(), from ..._student_leaders.sql).

create table public.bom_catalog (
  id uuid primary key default gen_random_uuid(),
  vendor text not null check (char_length(vendor) between 1 and 100),
  vendor_part_number text not null check (char_length(vendor_part_number) between 1 and 100),
  -- The product's name, the way the vendor's page has it.
  name text not null check (char_length(name) between 1 and 100),
  -- Where to buy it. Needed: a link to buy it is what the catalog is for.
  -- Only https:// links with no spaces, so a link can't run code when
  -- someone opens it. Shop links can be long.
  product_url text not null check (product_url ~ '^https://\S+$' and char_length(product_url) <= 2000),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.members (id) on delete set null
);

-- One entry per vendor and vendor part number, ignoring capitals and
-- spaces, so "REV-21-1650" and "rev-21-1650 " can't both be added. (The app
-- also knows "REV" and "REV Robotics" are one vendor, and checks that first.)
create unique index bom_catalog_one_per_part on public.bom_catalog (
  lower(btrim(vendor)),
  lower(regexp_replace(vendor_part_number, '\s', '', 'g'))
);

alter table public.bom_catalog enable row level security;

-- Signed-out visitors get nothing. Signed-in people get what the rules allow.
revoke all on table public.bom_catalog from anon, authenticated;
grant select, insert, delete on table public.bom_catalog to authenticated;
-- Changing an entry can't change who added it or when: only these columns.
grant update (vendor, vendor_part_number, name, product_url) on table public.bom_catalog to authenticated;

-- Changes from other people show up in the app straight away.
alter publication supabase_realtime add table public.bom_catalog;

-- The rules. Wrapping the helpers in (select ...) lets the database work out
-- the answer once per query instead of once per row.
create policy "Members can read the catalog"
  on public.bom_catalog for select to authenticated
  using ((select private.is_member()));

create policy "Leaders can add to the catalog as themselves"
  on public.bom_catalog for insert to authenticated
  with check ((select private.is_leader()) and created_by = (select auth.uid()));

create policy "Leaders can change catalog entries"
  on public.bom_catalog for update to authenticated
  using ((select private.is_leader()))
  with check ((select private.is_leader()));

create policy "Leaders can delete catalog entries"
  on public.bom_catalog for delete to authenticated
  using ((select private.is_leader()));
