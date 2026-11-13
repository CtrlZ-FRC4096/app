-- Prescouting stars (#118): people star the teams they care about, so
-- those teams come first in the prescouting list. A star is either just for
-- the person who made it, or for the whole team. A star for the whole team
-- needs a reason, so everyone knows why that team matters.
--
-- This replaces the shared Mark on prescouting_notes (its "marked" column):
-- every team marked so far becomes a team star below, with a reason saying
-- so. Nobody knows who marked it, so its created_by is empty. The app no
-- longer reads "marked"; a later migration can drop it once a mentor agrees.
--
-- Who sees what:
--   - Your own stars, of both kinds.
--   - Everyone's team stars.
--   - Nobody else's stars that are just for them.
-- You add stars only as yourself, and remove your own. Mentors and admins
-- can also remove anyone's team star. Nobody changes a star: remove it and
-- star the team again.

create table public.scouting_prescout_stars (
  id uuid primary key default gen_random_uuid(),
  -- The event, like 2026ilch, and the team starred there.
  event_key text not null check (char_length(event_key) between 1 and 40),
  team_number integer not null check (team_number between 1 and 99999),
  -- True for the whole team, false for just the person who made it.
  for_team boolean not null,
  -- Why the team should look at them. A star for the whole team must have one.
  reason text check (char_length(reason) between 1 and 500),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.members (id) on delete cascade,
  constraint team_stars_have_a_reason check (not for_team or reason is not null),
  -- Each person stars a team once of each kind at an event. Several people
  -- can star the same team for the whole team, each with their own reason.
  unique (event_key, team_number, created_by, for_team)
);

create index on public.scouting_prescout_stars (event_key);

alter table public.scouting_prescout_stars enable row level security;

-- Signed-out visitors get nothing. There's no update.
revoke all on table public.scouting_prescout_stars from anon, authenticated;
grant select, insert, delete on table public.scouting_prescout_stars to authenticated;

-- Changes from other people show up in the app straight away.
alter publication supabase_realtime add table public.scouting_prescout_stars;

-- The rules. Wrapping the helpers in (select ...) lets the database work out
-- the answer once per query instead of once per row.

create policy "Members see team stars and their own"
  on public.scouting_prescout_stars for select to authenticated
  using ((select private.is_member()) and (for_team or created_by = (select auth.uid())));

create policy "Members star teams as themselves"
  on public.scouting_prescout_stars for insert to authenticated
  with check ((select private.is_member()) and created_by = (select auth.uid()));

create policy "Members remove their own stars, and mentors any team star"
  on public.scouting_prescout_stars for delete to authenticated
  using (
    (select private.is_member())
    and (created_by = (select auth.uid()) or (for_team and (select private.is_mentor())))
  );

-- Keep the teams already marked, as team stars.
insert into public.scouting_prescout_stars (event_key, team_number, for_team, reason, created_by)
select event_key, team_number, true, 'Marked before stars had reasons', null
from public.prescouting_notes
where marked;
