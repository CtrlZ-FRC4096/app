-- Inventory: anyone on the team takes parts from the shelf or adds them, and
-- every change is recorded (issue #2).
--
--   inventory_changes   one line per change: which part, how many (-2 or
--                       +10), a note, who and when. Members add their own
--                       lines and read everyone's. Nobody edits or deletes
--                       them, so the history stays what happened.
--   inventory_items     members can now change a part's quantity. Only
--                       mentors and admins change anything else, which the
--                       trigger below enforces.
--
-- The app changes the quantity, then adds the line, as two steps. If two
-- people take the same part at the same moment, one can overwrite the other.
-- That's fine to start with: later, one database function can do both.
--
-- The helpers private.is_member() and private.is_mentor() come from the
-- members migration. private.is_mentor() is true for mentors and admins.

create table public.inventory_changes (
  id uuid primary key default gen_random_uuid(),
  -- Deleting a part (mentors only) deletes its history with it.
  item_id uuid not null references public.inventory_items (id) on delete cascade,
  -- How many were added (+10) or taken (-2). Never 0.
  change integer not null check (change <> 0),
  -- Optional, like "for the intake rebuild".
  note text not null default '' check (char_length(note) <= 200),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.members (id) on delete set null
);

create index on public.inventory_changes (item_id);

alter table public.inventory_changes enable row level security;

-- Signed-out visitors get nothing. Signed-in people can read and add lines,
-- but never change or delete one: there's no update or delete grant.
revoke all on table public.inventory_changes from anon, authenticated;
grant select, insert on table public.inventory_changes to authenticated;

-- Changes from other people show up in the app straight away.
alter publication supabase_realtime add table public.inventory_changes;

-- The rules. Wrapping the helpers in (select ...) lets the database work out
-- the answer once per query instead of once per row.

create policy "Members can read stock changes"
  on public.inventory_changes for select to authenticated
  using ((select private.is_member()));

create policy "Members can record their own stock changes"
  on public.inventory_changes for insert to authenticated
  with check ((select private.is_member()) and created_by = (select auth.uid()));


-- Members can change parts too, alongside the mentors' rule from
-- ..._inventory_items.sql. The trigger below limits them to the quantity.
-- (A column grant can't do this: it would apply to mentors as well, and
-- mentors' Edit button changes a part's location.)

create policy "Members can change how many of a part there are"
  on public.inventory_items for update to authenticated
  using ((select private.is_member()))
  with check ((select private.is_member()));

-- Only mentors and admins change anything but the quantity. Comparing every
-- column except quantity means a column added later is covered too. It only
-- checks people using the app: the dashboard and server functions, which
-- have no signed-in person, aren't limited.
create function private.only_mentors_change_parts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null
    and not private.is_mentor()
    and (to_jsonb(new) - 'quantity') is distinct from (to_jsonb(old) - 'quantity')
  then
    raise exception 'Only mentors and admins can change a part''s name, location or low-stock level. You can take or add stock.';
  end if;
  return new;
end;
$$;

revoke all on function private.only_mentors_change_parts() from public;

create trigger only_mentors_change_parts
  before update on public.inventory_items
  for each row execute function private.only_mentors_change_parts();
