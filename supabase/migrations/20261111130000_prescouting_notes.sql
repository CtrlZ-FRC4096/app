-- The Prescouting module's notes (#117): what we know about a team
-- before an event, written by anyone on the team. One row per team per
-- event.
--
-- Prescouting happens before the event, with Wi-Fi, so the app saves
-- straight here (a table from createTable()), not on the phone first like
-- the Scouting module's match entries.
--
-- marked: a star on teams the strategy team cares about (#118). Shared, so
-- everyone sees the same marked teams.
--
-- Signed-in members read every row, add one, and change any of them. Only
-- mentors and admins delete them.

create table public.prescouting_notes (
  id uuid primary key default gen_random_uuid(),
  -- The event, like 2026ilch.
  event_key text not null check (char_length(event_key) between 1 and 40),
  team_number integer not null check (team_number between 1 and 99999),
  -- The answers. Empty until someone fills them in.
  strengths text not null default '' check (char_length(strengths) <= 2000),
  weaknesses text not null default '' check (char_length(weaknesses) <= 2000),
  -- The main job they do in a match, like scoring in auto or playing defense.
  key_task text not null default '' check (char_length(key_task) <= 2000),
  -- Where they start, and what their auto does.
  auto_paths text not null default '' check (char_length(auto_paths) <= 2000),
  -- How they've done this season, like their results at earlier events.
  performance text not null default '' check (char_length(performance) <= 2000),
  other_notes text not null default '' check (char_length(other_notes) <= 2000),
  marked boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.members (id) on delete set null,
  -- One row per team per event: the app changes it after the first save.
  unique (event_key, team_number)
);

alter table public.prescouting_notes enable row level security;

-- Signed-out visitors get nothing. Signed-in people get what the rules allow.
-- Members change only the answers and the mark, never which team or event
-- a row is for, or who started it.
revoke all on table public.prescouting_notes from anon, authenticated;
grant select, insert, delete on table public.prescouting_notes to authenticated;
grant update (strengths, weaknesses, key_task, auto_paths, performance, other_notes, marked) on table public.prescouting_notes to authenticated;

-- Changes from other people show up in the app straight away.
alter publication supabase_realtime add table public.prescouting_notes;

-- The rules. Wrapping the helpers in (select ...) lets the database work out
-- the answer once per query instead of once per row.

create policy "Members can read prescouting"
  on public.prescouting_notes for select to authenticated
  using ((select private.is_member()));

create policy "Members can add prescouting as themselves"
  on public.prescouting_notes for insert to authenticated
  with check ((select private.is_member()) and created_by = (select auth.uid()));

create policy "Members can change prescouting"
  on public.prescouting_notes for update to authenticated
  using ((select private.is_member()))
  with check ((select private.is_member()));

create policy "Mentors can delete prescouting"
  on public.prescouting_notes for delete to authenticated
  using ((select private.is_mentor()));
