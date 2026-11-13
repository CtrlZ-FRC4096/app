-- Choosing which notifications you get (#155): the "What to notify me
-- about" switches on the Notifications page.
--
-- Each module lists its kinds of notification in its index.ts
-- (`notifications`), each with a key like 'purchasing.request_updates' and
-- whether it's on for people who haven't chosen. This table keeps only the
-- choices people have made:
--
--   - One row per person per kind they've switched. No row means "use the
--     module's default".
--   - People see and change only their own. Not even mentors see anyone
--     else's.
--
-- Notifications now also say which kind they are (`topic`), so the app
-- knows where each one came from. "Send me a test" has none: it always
-- works.
--
-- The database checks the setting before adding a notification, with
-- private.wants_notification() below, so a switched-off one is never added
-- at all. Every trigger that adds notifications should use it, like
-- notify_purchase_requester() at the bottom of this file.

create table public.notification_settings (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null default auth.uid() references public.members (id) on delete cascade,
  -- The module's id, a dot, then the kind, like purchasing.request_updates.
  key text not null check (key ~ '^[a-z][a-z0-9-]*\.[a-z][a-z0-9_]*$' and length(key) <= 100),
  enabled boolean not null,
  created_at timestamptz not null default now(),
  unique (member_id, key)
);

alter table public.notification_settings enable row level security;

revoke all on table public.notification_settings from anon, authenticated;
grant select, insert, delete on table public.notification_settings to authenticated;
-- Switching one on or off is the only change.
grant update (enabled) on table public.notification_settings to authenticated;

alter publication supabase_realtime add table public.notification_settings;

create policy "People see their own notification settings"
  on public.notification_settings for select to authenticated
  using (member_id = (select auth.uid()) and (select private.is_member()));

create policy "People add their own notification settings"
  on public.notification_settings for insert to authenticated
  with check (member_id = (select auth.uid()) and (select private.is_member()));

create policy "People change their own notification settings"
  on public.notification_settings for update to authenticated
  using (member_id = (select auth.uid()) and (select private.is_member()))
  with check (member_id = (select auth.uid()));

create policy "People delete their own notification settings"
  on public.notification_settings for delete to authenticated
  using (member_id = (select auth.uid()) and (select private.is_member()));

-- Which kind of notification each one is, like purchasing.request_updates.
-- Empty for "Send me a test".
alter table public.notifications
  add column topic text check (topic ~ '^[a-z][a-z0-9-]*\.[a-z][a-z0-9_]*$' and length(topic) <= 100);

-- Whether someone wants one kind of notification: their choice if they've
-- made one, or else `default_on`, which must match `on` in the module's
-- index.ts.
--
-- Only the database's own functions use it (it isn't granted to anyone),
-- so nobody can use it to look up someone else's choices.
create function private.wants_notification(person uuid, setting text, default_on boolean)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select enabled from public.notification_settings where member_id = person and key = setting),
    default_on
  );
$$;

revoke all on function private.wants_notification(uuid, text, boolean) from public;

-- The purchase request notifications (..._purchase_notifications.sql), now
-- skipping people who switched off Purchasing -> My requests. It's on unless
-- they did, like `on: true` in src/modules/purchasing/index.ts. Everything
-- else about it is the same.
create or replace function private.notify_purchase_requester()
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

  if not private.wants_notification(new.requested_by, 'purchasing.request_updates', true) then
    return null;
  end if;

  insert into public.notifications (member_id, title, body, url, topic)
  values (
    new.requested_by,
    case new.status
      when 'placed' then 'Your request was ordered'
      else 'Your request arrived'
    end,
    new.name,
    './#/purchasing/item/' || new.id,
    'purchasing.request_updates'
  );
  return null;
end;
$$;
