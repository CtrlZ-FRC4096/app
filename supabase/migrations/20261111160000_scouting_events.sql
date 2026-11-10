-- The event the whole team is scouting, picked by a mentor in the app, so
-- every phone uses the same event: its schedule, rankings and ratings, and
-- the event its scouting entries are saved under.
--
-- Each row is one time a mentor picked an event. The newest row is the
-- current event, so there's nothing to change or delete, and the history
-- of who changed it, and when, stays. Until a mentor picks one, the app
-- uses EVENT_KEY from src/modules/scouting/season.ts.
--
-- Signed-in members read it. Only mentors and admins pick an event.

create table public.scouting_events (
  id uuid primary key default gen_random_uuid(),
  -- The Blue Alliance's event key, like 2026ilch.
  event_key text not null check (event_key ~ '^[0-9]{4}[a-z0-9]{1,16}$'),
  -- The event's name from The Blue Alliance, like "Midwest Regional", so the
  -- app can show it without asking TBA.
  name text not null check (char_length(name) between 1 and 200),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.members (id) on delete set null
);

alter table public.scouting_events enable row level security;

-- Signed-out visitors get nothing. Signed-in people get what the rules
-- allow. Nobody changes or deletes a row: picking again adds a new one.
revoke all on table public.scouting_events from anon, authenticated;
grant select, insert on table public.scouting_events to authenticated;

-- A new pick shows up on every phone straight away.
alter publication supabase_realtime add table public.scouting_events;

-- The rules. Wrapping the helpers in (select ...) lets the database work out
-- the answer once per query instead of once per row.

create policy "Members can see which event the team is scouting"
  on public.scouting_events for select to authenticated
  using ((select private.is_member()));

create policy "Mentors can pick the event, as themselves"
  on public.scouting_events for insert to authenticated
  with check ((select private.is_mentor()) and created_by = (select auth.uid()));
