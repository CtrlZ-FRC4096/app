-- Purchasing: receipts (#79, step 4 of #66). A PDF or photo of a receipt,
-- added to an item.
--
-- Receipts can show card digits, addresses and names, so:
--
--   - Only mentors, admins and purchasers can add, open and delete them.
--   - Everyone on the team can see that an item has a receipt: that's what
--     the purchase_receipts table is for. It doesn't hold the file, or the
--     file's name, which can have personal details in it too.
--
-- The files are in a private storage bucket, so there's no public address
-- for them. Mentors and purchasers open one through a signed link that stops working after
-- a short time (see receiptLink() in src/modules/purchasing/data.ts).
-- Making a signed link needs the select rule below, so nobody else can
-- make one.
--
-- Only exact file types are allowed, not image/*: that would let in SVG
-- images, which can run code when they're opened.
--
-- The helpers private.is_member() and private.is_purchaser() (which
-- includes mentors and admins) come from the members and purchasing_orders
-- migrations.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'purchase-receipts',
  'purchase-receipts',
  false,
  10485760, -- 10 MB
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
);

-- One row per receipt. An item can have several. An item with a receipt
-- can't be deleted until a mentor or purchaser deletes the receipt: that keeps the
-- record of what was spent, and leaves no file behind that nobody can reach.
create table public.purchase_receipts (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.purchase_items (id) on delete restrict,
  -- Where the file is in the bucket: the item's id, then a random id. Not
  -- the file's own name.
  path text not null unique check (
    split_part(path, '/', 1) = item_id::text
    and path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(pdf|jpg|png|webp|heic|heif)$'
  ),
  content_type text not null check (content_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif')),
  size_bytes integer not null check (size_bytes between 1 and 10485760),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.members (id) on delete set null
);

create index on public.purchase_receipts (item_id);

alter table public.purchase_receipts enable row level security;

-- Signed-out visitors get nothing. Nobody can change a receipt after adding it.
revoke all on table public.purchase_receipts from anon, authenticated;
grant select, insert, delete on table public.purchase_receipts to authenticated;

alter publication supabase_realtime add table public.purchase_receipts;

create policy "Members can see which items have receipts"
  on public.purchase_receipts for select to authenticated
  using ((select private.is_member()));

create policy "Mentors and purchasers add receipts as themselves"
  on public.purchase_receipts for insert to authenticated
  with check ((select private.is_purchaser()) and created_by = (select auth.uid()));

create policy "Mentors and purchasers delete receipts"
  on public.purchase_receipts for delete to authenticated
  using ((select private.is_purchaser()));

-- The rules for the files themselves. storage.objects holds every bucket's
-- files, so each rule starts by naming this bucket.
--
-- There's no update rule, so a receipt can't be replaced by another file.

create policy "Mentors and purchasers open purchase receipts"
  on storage.objects for select to authenticated
  using (bucket_id = 'purchase-receipts' and (select private.is_purchaser()));

-- Files go in a folder named after a real item. It has to say objects.name:
-- purchase_items has a name column too, and a plain "name" would mean that.
create policy "Mentors and purchasers add purchase receipts"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'purchase-receipts'
    and (select private.is_purchaser())
    and exists (select 1 from public.purchase_items i where i.id::text = split_part(objects.name, '/', 1))
  );

create policy "Mentors and purchasers delete purchase receipts"
  on storage.objects for delete to authenticated
  using (bucket_id = 'purchase-receipts' and (select private.is_purchaser()));
