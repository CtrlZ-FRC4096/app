-- The Scouting module's pit entries: what a scout learned talking to a team
-- in their pit. They're saved on the scout's device first and sent here
-- when there's a connection, so the device makes each row's id. Sending the
-- same entry twice then fails on the primary key instead of making a copy.
--
-- Teams change their robots, so every visit is kept: there's no "one row
-- per team" rule.

create table public.scouting_pit_entries (
  id uuid primary key default gen_random_uuid(),
  team integer not null check (team > 0),
  -- The choices are in src/modules/scouting/season.ts, and change by season,
  -- so they aren't listed here.
  drivetrain text check (char_length(drivetrain) between 1 and 60),
  weight_lb numeric check (weight_lb > 0),
  length_in numeric check (length_in > 0),
  width_in numeric check (width_in > 0),
  height_in numeric check (height_in > 0),
  motors text not null default '' check (char_length(motors) <= 1000),
  auto_side text check (char_length(auto_side) between 1 and 60),
  auto_path text not null default '' check (char_length(auto_path) <= 1000),
  partner_strategy text not null default '' check (char_length(partner_strategy) <= 1000),
  own_strategy text not null default '' check (char_length(own_strategy) <= 1000),
  -- When it was saved on the device, which can be well before it's sent.
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.members (id) on delete set null
);

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

create policy "Members can add pit entries as themselves"
  on public.scouting_pit_entries for insert to authenticated
  with check ((select private.is_member()) and created_by = (select auth.uid()));

create policy "Mentors can change pit entries"
  on public.scouting_pit_entries for update to authenticated
  using ((select private.is_mentor()))
  with check ((select private.is_mentor()));

create policy "Mentors can remove pit entries"
  on public.scouting_pit_entries for delete to authenticated
  using ((select private.is_mentor()));
