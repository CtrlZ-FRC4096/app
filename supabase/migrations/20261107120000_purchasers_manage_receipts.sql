-- Purchasing: purchasers can open and delete receipts, as well as add them.
--
-- A purchaser who added the wrong file couldn't check it or remove it, so it
-- needed a mentor. A mentor asked for this change.
--
-- Receipts can show card digits and addresses, so this is still limited:
-- private.is_purchaser() is true for mentors, admins and purchasers, and
-- stops being true as soon as someone is removed as a purchaser. Students
-- still can't open or delete them.

drop policy "Mentors delete receipts" on public.purchase_receipts;

create policy "Mentors and purchasers delete receipts"
  on public.purchase_receipts for delete to authenticated
  using ((select private.is_purchaser()));

drop policy "Mentors open purchase receipts" on storage.objects;

create policy "Mentors and purchasers open purchase receipts"
  on storage.objects for select to authenticated
  using (bucket_id = 'purchase-receipts' and (select private.is_purchaser()));

drop policy "Mentors delete purchase receipts" on storage.objects;

create policy "Mentors and purchasers delete purchase receipts"
  on storage.objects for delete to authenticated
  using (bucket_id = 'purchase-receipts' and (select private.is_purchaser()));
