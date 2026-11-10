-- The Scouting module's match entries (#31): what a scout counted for one
-- robot in one match.
--
-- Entries are saved on the scout's phone first, because venue Wi-Fi is
-- unreliable (src/modules/scouting/data.ts), then sent here when there's a
-- connection. Each entry keeps the id the phone gave it, so sending the same
-- entry twice can't make two rows: the app sends them with "on conflict do
-- nothing", and the database skips an id it already has.
--
-- Signed-in members read every entry and add their own. Only mentors and
-- admins change or delete them.

create table public.scouting_entries (
  -- Made on the phone, not here.
  id uuid primary key,
  -- The event, like 2026ilch, so match numbers from different events don't mix.
  event_key text not null check (char_length(event_key) between 1 and 40),
  match_number integer not null check (match_number between 1 and 1000),
  team_number integer not null check (team_number between 1 and 99999),
  -- The count for each counter in src/modules/scouting/season.ts, by its key,
  -- like {"autoFuel": 3}. A new season's counters need no migration.
  counts jsonb not null default '{}' check (jsonb_typeof(counts) = 'object'),
  endgame text not null check (char_length(endgame) between 1 and 60),
  -- Any of ROLES in season.ts, like {Scorer,Defender}. Empty if none was chosen.
  roles text[] not null default '{}' check (cardinality(roles) <= 20),
  broke_down boolean not null default false,
  -- These are FRC rules, so they don't change with the game.
  stop text not null default 'None' check (stop in ('None', 'A-stop', 'E-stop')),
  -- 1 to 5. Empty for entries saved before driver skill was on the form.
  driver_skill integer check (driver_skill between 1 and 5),
  notes text check (char_length(notes) between 1 and 1000),
  -- Who scouted it, and when, on the phone. Usually whoever sends it, but a
  -- phone shared between scouts can send someone else's entries.
  scouted_by uuid references public.members (id) on delete set null,
  scouted_at timestamptz not null,
  -- When it reached the team database, and who sent it.
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.members (id) on delete set null
);

create index on public.scouting_entries (event_key, team_number);

alter table public.scouting_entries enable row level security;

-- Signed-out visitors get nothing. Signed-in people get what the rules allow.
revoke all on table public.scouting_entries from anon, authenticated;
grant select, insert, update, delete on table public.scouting_entries to authenticated;

-- Changes from other people show up in the app straight away.
alter publication supabase_realtime add table public.scouting_entries;

-- The rules. Wrapping the helpers in (select ...) lets the database work out
-- the answer once per query instead of once per row.

create policy "Members can read scouting entries"
  on public.scouting_entries for select to authenticated
  using ((select private.is_member()));

create policy "Members can send scouting entries as themselves"
  on public.scouting_entries for insert to authenticated
  with check ((select private.is_member()) and created_by = (select auth.uid()));

create policy "Mentors can change scouting entries"
  on public.scouting_entries for update to authenticated
  using ((select private.is_mentor()))
  with check ((select private.is_mentor()));

create policy "Mentors can delete scouting entries"
  on public.scouting_entries for delete to authenticated
  using ((select private.is_mentor()));
