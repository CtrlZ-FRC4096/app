-- Notifications in the app: the list behind the bell at the top right.
--
-- Each row is one notification for one person. The same ones can also go
-- to their phone (see ..._push_subscriptions.sql), but they're kept here
-- too, so nobody misses one because notifications are off on their phone.
--
--   - People see only their own, mark them read, and delete them. Not
--     even mentors see anyone else's.
--   - For now people can only add notifications for themselves (the
--     Notifications page's "Send me a test"). Notifications for other
--     people, like "your request was ordered", come in a later step, from
--     the database itself.
--   - A notification opens a page inside the app, never another site, so
--     one can't be used to send people somewhere else.

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null default auth.uid() references public.members (id) on delete cascade,
  title text not null check (length(trim(title)) between 1 and 100),
  body text not null default '' check (length(body) <= 500),
  -- A page in the app, like ./#/purchasing/item/<id>.
  url text check (url ~ '^\./#/\S*$' and length(url) <= 500),
  created_at timestamptz not null default now(),
  -- When they read it; empty while it's new.
  read_at timestamptz
);

create index on public.notifications (member_id, created_at desc);

alter table public.notifications enable row level security;

revoke all on table public.notifications from anon, authenticated;
grant select, insert, delete on table public.notifications to authenticated;
-- Reading one is the only change.
grant update (read_at) on table public.notifications to authenticated;

alter publication supabase_realtime add table public.notifications;

create policy "People see their own notifications"
  on public.notifications for select to authenticated
  using (member_id = (select auth.uid()) and (select private.is_member()));

create policy "People add notifications for themselves"
  on public.notifications for insert to authenticated
  with check (member_id = (select auth.uid()) and (select private.is_member()));

create policy "People mark their own notifications read"
  on public.notifications for update to authenticated
  using (member_id = (select auth.uid()) and (select private.is_member()))
  with check (member_id = (select auth.uid()));

create policy "People delete their own notifications"
  on public.notifications for delete to authenticated
  using (member_id = (select auth.uid()) and (select private.is_member()));
