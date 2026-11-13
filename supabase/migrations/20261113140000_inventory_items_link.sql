-- A link to each Inventory part's product page, where we buy it (issue #193),
-- so anyone can open it, and ordering more can fill it in (#194).
--
-- Optional. Only https:// links, so a link can't run code when someone opens
-- it, like Purchasing's link. Shop links can be long.
--
-- Who can set it is the same as the vendor and part number: anyone on the
-- team can fill it in when adding a part, and after that only mentors and
-- admins change it. The trigger private.only_mentors_change_parts() from
-- ..._inventory_changes.sql already decides that: it compares every column
-- except quantity, so it covers this new column without being changed.
-- supabase/tests/inventory-changes.test.ts checks it.

alter table public.inventory_items
  add column link text check (link like 'https://%' and char_length(link) <= 2000);
