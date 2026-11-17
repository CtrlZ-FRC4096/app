-- The Build progress grid (#65, step 2): one row per subsystem, with where
-- each of its stages stands.
--
-- Who can do what:
--   everyone on the team    reads the grid
--   student leaders, mentors and admins (private.is_leader())
--                           change cells, and add, rename, reorder and
--                           remove subsystems
--   students                can't change anything
--
-- The stages (Design, Built, Wired, …) are STAGES in
-- src/modules/progress/data.ts, not columns here, so adding or renaming a
-- stage needs no migration. `stages` holds each stage's state by name, like
-- {"Design": "Done", "Built": "In progress"}; a stage that isn't there is
-- Not started.

create table public.build_subsystems (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(name) between 1 and 60),
  -- The order on the grid, smallest first.
  position integer not null default 0,
  stages jsonb not null default '{}' check (jsonb_typeof(stages) = 'object'),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.members (id) on delete set null
);

alter table public.build_subsystems enable row level security;

-- Signed-out visitors get nothing. Signed-in people get what the rules allow.
revoke all on table public.build_subsystems from anon, authenticated;
grant select, insert, update, delete on table public.build_subsystems to authenticated;

-- Changes from other people show up in the app straight away.
alter publication supabase_realtime add table public.build_subsystems;

-- The rules. Wrapping the helpers in (select ...) lets the database work out
-- the answer once per query instead of once per row. private.is_leader() is
-- from ..._student_leaders.sql.

create policy "Members can see build progress"
  on public.build_subsystems for select to authenticated
  using ((select private.is_member()));

create policy "Leaders can add subsystems as themselves"
  on public.build_subsystems for insert to authenticated
  with check ((select private.is_leader()) and created_by = (select auth.uid()));

create policy "Leaders can change build progress"
  on public.build_subsystems for update to authenticated
  using ((select private.is_leader()))
  with check ((select private.is_leader()));

create policy "Leaders can remove subsystems"
  on public.build_subsystems for delete to authenticated
  using ((select private.is_leader()));
