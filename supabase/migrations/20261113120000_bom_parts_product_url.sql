-- A link to a COTS part's product page, where we buy it (issue #169).
-- Optional. Only https:// links, so a link can't run code when someone
-- opens it, like onshape_url. Shop links can be long.
--
-- Who can change it is the same as the rest of a part: student leaders,
-- mentors and admins (the "Leaders can change parts" rule in
-- ..._bom_student_leaders.sql). ..._bom_members_edit.sql limits which
-- columns can be updated, so it's added to that list.

alter table public.bom_parts
  add column product_url text check (product_url like 'https://%' and char_length(product_url) <= 2000);

grant update (product_url) on table public.bom_parts to authenticated;
