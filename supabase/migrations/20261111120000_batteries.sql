-- The Batteries module's table: the team's robot batteries, and where each
-- one is in its cycle (Charged, In the robot, Needs charging, Charging,
-- Resting). Made to be used on a phone in the pit.
--
-- Who can do what:
--   members   read every battery, and change a battery's status
--   mentors   also add, rename, retire, change notes and delete batteries
-- The trigger below keeps members to the status, since a column grant would
-- stop mentors too (the same as ..._inventory_changes.sql).
--
-- The statuses are listed in src/modules/batteries/data.ts, not here, so
-- they're easy to change.

create table public.batteries (
  id uuid primary key default gen_random_uuid(),
  -- The number written on the battery, like 2026-3.
  name text not null unique check (char_length(name) between 1 and 30),
  status text not null default 'Charged' check (char_length(status) between 1 and 40),
  -- When the status last changed. The trigger below sets it, so a phone
  -- with the wrong time can't get it wrong.
  status_changed_at timestamptz not null default now(),
  -- A battery the team no longer uses. Kept for its history.
  retired boolean not null default false,
  notes text not null default '' check (char_length(notes) <= 500),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.members (id) on delete set null
);

alter table public.batteries enable row level security;

-- Signed-out visitors get nothing. Signed-in people get what the rules allow.
revoke all on table public.batteries from anon, authenticated;
grant select, insert, update, delete on table public.batteries to authenticated;

-- Changes from other phones in the pit show up straight away.
alter publication supabase_realtime add table public.batteries;

-- The rules. Wrapping the helpers in (select ...) lets the database work out
-- the answer once per query instead of once per row.

create policy "Members can see the batteries"
  on public.batteries for select to authenticated
  using ((select private.is_member()));

create policy "Mentors can add batteries as themselves"
  on public.batteries for insert to authenticated
  with check ((select private.is_mentor()) and created_by = (select auth.uid()));

create policy "Members can change batteries (students only the status: see the trigger)"
  on public.batteries for update to authenticated
  using ((select private.is_member()))
  with check ((select private.is_member()));

create policy "Mentors can delete batteries"
  on public.batteries for delete to authenticated
  using ((select private.is_mentor()));

-- Before every change: only mentors and admins change anything but the
-- status, and status_changed_at is always the database's own time. Comparing
-- every other column means a column added later is covered too. Like the
-- inventory trigger, it only limits people using the app.
create function private.before_battery_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null
    and not private.is_mentor()
    and (to_jsonb(new) - 'status' - 'status_changed_at') is distinct from (to_jsonb(old) - 'status' - 'status_changed_at')
  then
    raise exception 'Only mentors and admins can rename, retire or change the notes on a battery. You can change its status.';
  end if;
  if new.status is distinct from old.status then
    new.status_changed_at := now();
  else
    new.status_changed_at := old.status_changed_at;
  end if;
  return new;
end;
$$;

revoke all on function private.before_battery_change() from public;

create trigger before_battery_change
  before update on public.batteries
  for each row execute function private.before_battery_change();
