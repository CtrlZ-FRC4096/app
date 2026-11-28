-- Notifications for purchase requests (step 5 of #93): when someone's
-- request is ordered or arrives, it shows in their bell.
--
--   - Order Placed: "Your request was ordered".
--   - Received: "Your request arrived".
--   - It goes to whoever asked for the item (requested_by), and opens the
--     item in Purchasing.
--   - Nobody gets one for a change they made themselves, or for an item
--     whose requester's account was deleted (requested_by is empty).
--   - Only changing an item's status sends one. Adding an item that's
--     already ordered (like importing the Slack list) doesn't.
--
-- People can only add notifications for themselves (see
-- ..._notifications.sql), so the database adds these itself: the function
-- below is "security definer", which means it runs as the database owner,
-- not as the person changing the item. That doesn't let anyone else add
-- notifications for other people: it only ever adds these two, for the
-- item's requester, when its status really changes.
--
-- These are in the app only for now. Sending them to phones too comes in a
-- later step, because the push function only sends to your own devices.

create function private.notify_purchase_requester()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Nobody asked for it any more, or they made the change themselves. (The
  -- database owner, like the SQL editor, has no auth.uid(), so its changes
  -- still send one.)
  if new.requested_by is null or new.requested_by is not distinct from auth.uid() then
    return null;
  end if;

  insert into public.notifications (member_id, title, body, url)
  values (
    new.requested_by,
    case new.status
      when 'placed' then 'Your request was ordered'
      else 'Your request arrived'
    end,
    new.name,
    './#/purchasing/item/' || new.id
  );
  return null;
end;
$$;

-- "after": it runs once the change has passed the order check (in
-- ..._purchase_items_price.sql), so only mentors and purchasers can set off
-- these two.
create trigger notify_purchase_requester
  after update of status on public.purchase_items
  for each row
  when (new.status is distinct from old.status and new.status in ('placed', 'received'))
  execute function private.notify_purchase_requester();
