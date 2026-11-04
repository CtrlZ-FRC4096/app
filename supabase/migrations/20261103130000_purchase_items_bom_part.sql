-- Purchasing: a request can say which BOM part it's for (#80), so the BOM
-- page can show each COTS part's order status, and its Purchase button can
-- fill in a request from the part.
--
-- It's set when the request is made from the BOM, and can't be changed
-- after: there's no update grant for it. Deleting the BOM part keeps the
-- request and clears the link.

alter table public.purchase_items
  add column bom_part_id uuid references public.bom_parts (id) on delete set null;

create index on public.purchase_items (bom_part_id);
