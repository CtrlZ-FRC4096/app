-- The Scouting module's shared picklist (#43): the order the strategy team
-- wants to pick teams in on alliance selection day, the same on every phone.
--
-- Each row is one team on one event's list. The list is in order of
-- position, smallest first. Moving a team changes only its own position, to
-- halfway between its new neighbours (src/modules/scouting/data.ts), so one
-- move is one small change, and two people moving different teams at once
-- don't undo each other.
--
-- Signed-in members read the list. Only mentors and admins add teams, move
-- them, mark them and take them off.

create table public.scouting_picklist (
  id uuid primary key default gen_random_uuid(),
  -- The event, like 2026ilch, so each event has its own list.
  event_key text not null check (char_length(event_key) between 1 and 40),
  team_number integer not null check (team_number between 1 and 99999),
  -- Smaller is higher on the list. Not 1, 2, 3: see the top of this file.
  position double precision not null,
  -- Picked: already on another alliance. Teams keep their place when marked.
  status text not null default 'Open' check (status in ('Open', 'Picked', 'Do not pick')),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.members (id) on delete set null,
  -- A team is on each event's list once.
  unique (event_key, team_number)
);

alter table public.scouting_picklist enable row level security;

-- Signed-out visitors get nothing. Signed-in people get what the rules allow.
-- Only position and status can be changed, so not even a mentor can turn a
-- row into a different team or event: take it off and add it again instead.
revoke all on table public.scouting_picklist from anon, authenticated;
grant select, insert, delete on table public.scouting_picklist to authenticated;
grant update (position, status) on table public.scouting_picklist to authenticated;

-- Changes from other people show up in the app straight away, so every
-- phone shows the same order.
alter publication supabase_realtime add table public.scouting_picklist;

-- The rules. Wrapping the helpers in (select ...) lets the database work out
-- the answer once per query instead of once per row.

create policy "Members can read the picklist"
  on public.scouting_picklist for select to authenticated
  using ((select private.is_member()));

create policy "Mentors can add teams to the picklist as themselves"
  on public.scouting_picklist for insert to authenticated
  with check ((select private.is_mentor()) and created_by = (select auth.uid()));

create policy "Mentors can move and mark teams on the picklist"
  on public.scouting_picklist for update to authenticated
  using ((select private.is_mentor()))
  with check ((select private.is_mentor()));

create policy "Mentors can take teams off the picklist"
  on public.scouting_picklist for delete to authenticated
  using ((select private.is_mentor()));
