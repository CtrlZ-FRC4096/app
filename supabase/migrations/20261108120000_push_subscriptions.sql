-- Phone notifications (Web Push), step 1: where to send each person's
-- notifications.
--
-- When someone turns on notifications, their browser gives the app an
-- address at Google, Apple or Mozilla's push service, plus two keys for
-- locking the message so only that browser can read it. Each row here is
-- one phone or computer.
--
-- The address works like a password for sending to that device, so:
--
--   - People see and remove only their own rows. Not even mentors see
--     anyone else's.
--   - Nobody adds or changes a row directly. save_push_subscription()
--     below adds it as whoever is signed in.
--   - The push server function (supabase/functions/push/) reads the rows
--     with the caller's own sign-in, so it can only send to them.
--
-- A phone shared by two people sends to whoever turned notifications on
-- last: saving an address takes it from anyone else who had it.

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null default auth.uid() references public.members (id) on delete cascade,
  endpoint text not null unique check (endpoint ~ '^https://\S+$' and length(endpoint) <= 2000),
  -- The browser's two keys, in base64url, as it gives them.
  p256dh text not null check (p256dh ~ '^[A-Za-z0-9_-]+=*$' and length(p256dh) between 80 and 100),
  auth text not null check (auth ~ '^[A-Za-z0-9_-]+=*$' and length(auth) between 16 and 32),
  created_at timestamptz not null default now()
);

create index on public.push_subscriptions (member_id);

alter table public.push_subscriptions enable row level security;

revoke all on table public.push_subscriptions from anon, authenticated;
grant select, delete on table public.push_subscriptions to authenticated;

create policy "People see their own devices"
  on public.push_subscriptions for select to authenticated
  using (member_id = (select auth.uid()) and (select private.is_member()));

create policy "People remove their own devices"
  on public.push_subscriptions for delete to authenticated
  using (member_id = (select auth.uid()) and (select private.is_member()));

-- How many devices one person can have. Turning one on past this drops
-- their oldest, which is most likely a phone they no longer use.
create function public.save_push_subscription(new_endpoint text, new_p256dh text, new_auth text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not private.is_member() then
    raise exception 'permission denied: only team members can turn on notifications'
      using errcode = '42501';
  end if;

  delete from public.push_subscriptions where endpoint = new_endpoint;
  insert into public.push_subscriptions (member_id, endpoint, p256dh, auth)
  values (auth.uid(), new_endpoint, new_p256dh, new_auth);

  -- Keep each person's 10 newest.
  delete from public.push_subscriptions
  where id in (
    select id from public.push_subscriptions
    where member_id = auth.uid()
    order by created_at desc, id
    offset 10
  );
end;
$$;

revoke execute on function public.save_push_subscription(text, text, text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text) to authenticated;
