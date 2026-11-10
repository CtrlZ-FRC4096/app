-- The Scouting module's pit entries (#35): what a team told a scout about
-- their robot in their pit. Based on the migration in #114.
--
-- Like match entries (..._scouting_entries.sql), they're saved on the
-- scout's phone first and sent here when there's a connection. Each keeps
-- the id the phone gave it, and the app sends them with "on conflict do
-- nothing", so sending the same entry twice can't make two rows.
--
-- Teams change their robots, so every visit is kept: there's no "one row
-- per team" rule.
--
-- Signed-in members read every pit entry and add their own. Only mentors
-- and admins change or delete them.

create table public.scouting_pit_entries (
  -- Made on the phone, not here.
  id uuid primary key,
  -- The event, like 2026ilch.
  event_key text not null check (char_length(event_key) between 1 and 40),
  team_number integer not null check (team_number between 1 and 99999),
  -- The qualification match it was before. Often empty: pit scouting
  -- usually happens before any match.
  match_number integer check (match_number between 1 and 1000),
  -- The choices are in src/modules/scouting/season.ts and change by season,
  -- so they aren't listed here.
  drivetrain text check (char_length(drivetrain) between 1 and 60),
  -- Pounds and inches. Empty if the scout left them blank.
  weight numeric check (weight > 0 and weight < 10000),
  length numeric check (length > 0 and length < 10000),
  width numeric check (width > 0 and width < 10000),
  height numeric check (height > 0 and height < 10000),
  motors text check (char_length(motors) between 1 and 1000),
  auto_side text check (char_length(auto_side) between 1 and 60),
  auto_path text check (char_length(auto_path) between 1 and 1000),
  -- "What do they want their partners to do?"
  partners_do text check (char_length(partners_do) between 1 and 1000),
  -- "What will they do?"
  they_do text check (char_length(they_do) between 1 and 1000),
  -- Who scouted it, and when, on the phone. Usually whoever sends it, but a
  -- phone shared between scouts can send someone else's entries.
  scouted_by uuid references public.members (id) on delete set null,
  scouted_at timestamptz not null,
  -- When it reached the team database, and who sent it.
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.members (id) on delete set null
);

create index on public.scouting_pit_entries (event_key, team_number);

alter table public.scouting_pit_entries enable row level security;

-- Signed-out visitors get nothing. Signed-in people get what the rules allow.
revoke all on table public.scouting_pit_entries from anon, authenticated;
grant select, insert, update, delete on table public.scouting_pit_entries to authenticated;

-- Changes from other people show up in the app straight away.
alter publication supabase_realtime add table public.scouting_pit_entries;

-- The rules. Wrapping the helpers in (select ...) lets the database work out
-- the answer once per query instead of once per row.

create policy "Members can read pit entries"
  on public.scouting_pit_entries for select to authenticated
  using ((select private.is_member()));

create policy "Members can send pit entries as themselves"
  on public.scouting_pit_entries for insert to authenticated
  with check ((select private.is_member()) and created_by = (select auth.uid()));

create policy "Mentors can change pit entries"
  on public.scouting_pit_entries for update to authenticated
  using ((select private.is_mentor()))
  with check ((select private.is_mentor()));

create policy "Mentors can delete pit entries"
  on public.scouting_pit_entries for delete to authenticated
  using ((select private.is_mentor()));
