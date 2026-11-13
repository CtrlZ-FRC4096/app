-- The Prescouting module's stars (#118): people star the teams they care
-- about, so those teams come first in Prescouting and Scouting.
--
-- A star is either just for the person who made it (for_team false), or
-- for the whole team (for_team true). A team star needs a reason, so
-- everyone knows why that team matters. Several people can star the same
-- team for the whole team, each with their own reason.
--
-- This replaces the shared marked column on prescouting_notes from
-- ..._prescouting_notes.sql: marks are moved over as team stars at the
-- bottom of this file, then the column is dropped.
--
-- Rules:
--   - A star just for you can only be seen by the person who made it.
--   - Team stars can be seen by every signed-in member.
--   - Signed-in members add stars, only as themselves.
--   - You remove your own stars. Mentors and admins also remove any team star.
--   - Nobody changes a star: remove it and star again.

create table public.prescouting_stars (
  id uuid primary key default gen_random_uuid(),
  -- The event, like 2026ilch.
  event_key text not null check (char_length(event_key) between 1 and 40),
  team_number integer not null check (team_number between 1 and 99999),
  for_team boolean not null default false,
  -- Why the team should look at them. Optional for a star just for you.
  reason text not null default '' check (char_length(reason) <= 500),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.members (id) on delete set null,
  -- Checked here, not only on the page, so no app can save a team star without a reason.
  constraint team_stars_need_a_reason check (not for_team or char_length(btrim(reason)) > 0),
  -- One star of each kind per person per team per event.
  unique (event_key, team_number, created_by, for_team)
);

create index on public.prescouting_stars (event_key);

alter table public.prescouting_stars enable row level security;

-- Signed-out visitors get nothing. Signed-in people get what the rules allow.
revoke all on table public.prescouting_stars from anon, authenticated;
grant select, insert, delete on table public.prescouting_stars to authenticated;

-- Changes from other people show up in the app straight away.
alter publication supabase_realtime add table public.prescouting_stars;

-- The rules. Wrapping the helpers in (select ...) lets the database work out
-- the answer once per query instead of once per row.

create policy "Members see team stars and their own"
  on public.prescouting_stars for select to authenticated
  using ((select private.is_member()) and (for_team or created_by = (select auth.uid())));

create policy "Members can star teams as themselves"
  on public.prescouting_stars for insert to authenticated
  with check ((select private.is_member()) and created_by = (select auth.uid()));

create policy "Members remove their own stars, and mentors any team star"
  on public.prescouting_stars for delete to authenticated
  using (
    (select private.is_member())
    and (created_by = (select auth.uid()) or (for_team and (select private.is_mentor())))
  );

-- Move the old shared marks over as team stars. Marks had no reason and no
-- record of who marked the team, so they get a reason that says so, and no
-- created_by. A mentor can remove them.
insert into public.prescouting_stars (event_key, team_number, for_team, reason, created_at, created_by)
select event_key, team_number, true, 'Marked before stars were added', created_at, null
from public.prescouting_notes
where marked;

alter table public.prescouting_notes drop column marked;
