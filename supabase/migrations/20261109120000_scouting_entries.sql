-- The Scouting module's table: every match entry the team's scouts have
-- sent from their phones.
--
-- Entries are saved on the phone first (venue Wi-Fi is unreliable) and sent
-- here when there's a connection. The phone makes each entry's id, so if the
-- same entry is sent twice the id is already taken and no second row is
-- made. The app sends with "on conflict (id) do nothing", so a repeat is
-- skipped quietly instead of failing.
--
-- Members can read every entry and send their own. Mentors and admins can
-- change or delete entries, to fix mistakes.
--
-- The helpers private.is_member() and private.is_mentor() come from the
-- members migration. private.is_mentor() is true for mentors and admins.

create table public.scouting_entries (
  -- Made on the phone. No default, so an entry can't arrive without one.
  id uuid primary key,
  -- When the scout saved it on the phone, not when it arrived here.
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.members (id) on delete set null,
  -- The Blue Alliance's name for the event, like 2026ilch.
  event text not null check (char_length(event) between 1 and 32),
  match integer not null check (match > 0),
  team integer not null check (team > 0),
  -- The count for each counter in season.ts, by its key, like {"autoFuel": 3}.
  -- Counters change each season, so they aren't columns of their own.
  counts jsonb not null default '{}' check (jsonb_typeof(counts) = 'object'),
  endgame text not null check (char_length(endgame) <= 50),
  roles text[] not null default '{}',
  broke_down boolean not null default false,
  stop text not null default 'None' check (stop in ('None', 'A-stop', 'E-stop')),
  -- Empty only for entries saved before driver skill was on the form.
  driver_skill smallint check (driver_skill between 1 and 5),
  notes text not null default '' check (char_length(notes) <= 1000)
);

alter table public.scouting_entries enable row level security;

-- Signed-out visitors get nothing. Signed-in people get what the rules allow.
revoke all on table public.scouting_entries from anon, authenticated;
grant select, insert, update, delete on table public.scouting_entries to authenticated;

-- Entries from other scouts show up in the app straight away.
alter publication supabase_realtime add table public.scouting_entries;

-- The rules. Wrapping the helpers in (select ...) lets the database work out
-- the answer once per query instead of once per row.

create policy "Members can read scouting entries"
  on public.scouting_entries for select to authenticated
  using ((select private.is_member()));

create policy "Members can send their own scouting entries"
  on public.scouting_entries for insert to authenticated
  with check ((select private.is_member()) and created_by = (select auth.uid()));

create policy "Mentors and admins can change scouting entries"
  on public.scouting_entries for update to authenticated
  using ((select private.is_mentor()))
  with check ((select private.is_mentor()));

create policy "Mentors and admins can delete scouting entries"
  on public.scouting_entries for delete to authenticated
  using ((select private.is_mentor()));
