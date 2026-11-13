-- Prescouting: scouting a team's matches from video before an event (#153).
-- A scout watches one of a team's matches from earlier this season and
-- fills in the season's counters, endgame and roles
-- (src/modules/scouting/season.ts), like the match form, with notes.
--
-- Each row is one scout's look at one team in one match. Several people
-- can scout the same match; each has their own row.
--
-- Prescouting happens before the event, with Wi-Fi, so it saves straight
-- here, like prescouting_notes, not on the phone first like match entries.
--
-- Signed-in members read every row, add their own, and change or remove
-- their own. Mentors and admins can remove anyone's.

create table public.prescouting_matches (
  id uuid primary key default gen_random_uuid(),
  -- The team scouted, and the event the match was at, like 2026ilch.
  team_number integer not null check (team_number between 1 and 99999),
  event_key text not null check (char_length(event_key) between 1 and 40),
  -- The Blue Alliance's key for the match, like 2026ilch_qm12.
  match_key text not null check (char_length(match_key) between 1 and 60 and match_key like event_key || '\_%'),
  -- The count for each counter in season.ts, by its key, like match entries.
  counts jsonb not null default '{}' check (jsonb_typeof(counts) = 'object'),
  endgame text not null check (char_length(endgame) between 1 and 60),
  roles text[] not null default '{}' check (cardinality(roles) <= 20),
  -- The same limit as the other prescouting answers.
  notes text not null default '' check (char_length(notes) <= 2000),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.members (id) on delete cascade,
  -- When it last changed. Set by the trigger below.
  updated_at timestamptz not null default now(),
  -- Each scout scouts a team once in each match.
  unique (match_key, team_number, created_by)
);

create index on public.prescouting_matches (team_number);

-- Keep updated_at right on every change, whatever the app sends.
create function private.prescouting_matches_touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end
$$;

create trigger prescouting_matches_touch
  before update on public.prescouting_matches
  for each row execute function private.prescouting_matches_touch();

alter table public.prescouting_matches enable row level security;

-- Signed-out visitors get nothing. Only what the scout saw can change, so a
-- row can't be turned into another team, match or scout.
revoke all on table public.prescouting_matches from anon, authenticated;
grant select, insert, delete on table public.prescouting_matches to authenticated;
grant update (counts, endgame, roles, notes) on table public.prescouting_matches to authenticated;

-- Changes from other people show up in the app straight away.
alter publication supabase_realtime add table public.prescouting_matches;

-- The rules. Wrapping the helpers in (select ...) lets the database work out
-- the answer once per query instead of once per row.

create policy "Members can read prescouted matches"
  on public.prescouting_matches for select to authenticated
  using ((select private.is_member()));

create policy "Members prescout matches as themselves"
  on public.prescouting_matches for insert to authenticated
  with check ((select private.is_member()) and created_by = (select auth.uid()));

create policy "Members change their own prescouted matches"
  on public.prescouting_matches for update to authenticated
  using ((select private.is_member()) and created_by = (select auth.uid()))
  with check ((select private.is_member()) and created_by = (select auth.uid()));

create policy "Members remove their own prescouted matches, and mentors anyone's"
  on public.prescouting_matches for delete to authenticated
  using ((select private.is_member()) and (created_by = (select auth.uid()) or (select private.is_mentor())));
