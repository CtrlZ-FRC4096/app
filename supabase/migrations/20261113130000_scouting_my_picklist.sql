-- The Scouting module's personal picklists (#151): each person's own order
-- for picking teams at an event, with a note on any team. The team
-- picklist averages everyone's (teamPicklist() in
-- src/modules/scouting/data.ts), so everyone signed in can read every list.
--
-- Each row is one team on one person's list for one event. rank is the
-- team's place on that list: 1 is best.
--
-- You add, change and remove only your own rows. Mentors and admins can
-- also remove anyone's, to tidy up after an event.

create table public.scouting_my_picklist (
  id uuid primary key default gen_random_uuid(),
  -- The event, like 2026ilch, so each event has its own lists.
  event_key text not null check (char_length(event_key) between 1 and 40),
  team_number integer not null check (team_number between 1 and 99999),
  -- The team's place on this person's list: 1 is best.
  rank integer not null check (rank >= 1),
  -- Like "Great defender, slow climb". Empty, not '', when there isn't one.
  note text check (char_length(note) between 1 and 500),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.members (id) on delete cascade,
  -- When the rank or note last changed. Set by the trigger below.
  updated_at timestamptz not null default now(),
  -- A team is on each person's list for an event once.
  unique (event_key, created_by, team_number)
);

create index on public.scouting_my_picklist (event_key);

-- Keep updated_at right on every change, whatever the app sends.
create function private.scouting_my_picklist_touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end
$$;

create trigger scouting_my_picklist_touch
  before update on public.scouting_my_picklist
  for each row execute function private.scouting_my_picklist_touch();

alter table public.scouting_my_picklist enable row level security;

-- Signed-out visitors get nothing. Only rank and note can be changed, so a
-- row can't be turned into a different team, event or person.
revoke all on table public.scouting_my_picklist from anon, authenticated;
grant select, insert, delete on table public.scouting_my_picklist to authenticated;
grant update (rank, note) on table public.scouting_my_picklist to authenticated;

-- Changes from other people show up in the app straight away, so the team
-- picklist updates by itself.
alter publication supabase_realtime add table public.scouting_my_picklist;

-- The rules. Wrapping the helpers in (select ...) lets the database work out
-- the answer once per query instead of once per row.

create policy "Members can read every picklist"
  on public.scouting_my_picklist for select to authenticated
  using ((select private.is_member()));

create policy "Members can add to their own picklist"
  on public.scouting_my_picklist for insert to authenticated
  with check ((select private.is_member()) and created_by = (select auth.uid()));

create policy "Members can change their own picklist"
  on public.scouting_my_picklist for update to authenticated
  using ((select private.is_member()) and created_by = (select auth.uid()))
  with check ((select private.is_member()) and created_by = (select auth.uid()));

create policy "Members remove from their own picklist, and mentors from anyone's"
  on public.scouting_my_picklist for delete to authenticated
  using ((select private.is_member()) and (created_by = (select auth.uid()) or (select private.is_mentor())));
