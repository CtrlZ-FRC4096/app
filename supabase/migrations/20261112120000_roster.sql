-- The Roster module: which students are active this season, and their
-- subteams. Mentors and admins see and change it. Everyone else sees only
-- their own entry (so Attendance can tell a student whether Monday meetings
-- are required for them), and nothing about anyone else.
--
--   roster_subteams          The subteams, like Mechanical. Mentors add,
--                            rename and remove them.
--   roster_students          One row per student or student leader a mentor
--                            has set: whether they're active this season.
--   roster_subteam_members   Who's on which subteam. A student can be on
--                            several, with one marked as their main one.

create table public.roster_subteams (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 40),
  -- Where it sits in lists, smallest first.
  position integer not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.members (id) on delete set null
);

-- Two subteams can't share a name, whatever the capitals.
create unique index roster_subteams_name on public.roster_subteams (lower(trim(name)));

create table public.roster_students (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null unique references public.members (id) on delete cascade,
  -- Active this season: Monday meetings are required for them (see Attendance).
  active boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.members (id) on delete set null
);

create table public.roster_subteam_members (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members (id) on delete cascade,
  subteam_id uuid not null references public.roster_subteams (id) on delete cascade,
  -- Their main subteam. At most one each.
  main boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.members (id) on delete set null,
  unique (member_id, subteam_id)
);

create unique index roster_one_main_subteam on public.roster_subteam_members (member_id) where main;

alter table public.roster_subteams enable row level security;
alter table public.roster_students enable row level security;
alter table public.roster_subteam_members enable row level security;

-- People only ever write these columns; the database fills in the rest.
revoke all on table public.roster_subteams, public.roster_students, public.roster_subteam_members from anon, authenticated;
grant select, delete on table public.roster_subteams, public.roster_students, public.roster_subteam_members to authenticated;
grant insert (name, position), update (name, position) on table public.roster_subteams to authenticated;
grant insert (member_id, active), update (active) on table public.roster_students to authenticated;
grant insert (member_id, subteam_id, main), update (main) on table public.roster_subteam_members to authenticated;

alter publication supabase_realtime add table public.roster_subteams, public.roster_students, public.roster_subteam_members;

create policy "Mentors see and change subteams"
  on public.roster_subteams for all to authenticated
  using ((select private.is_mentor()))
  with check ((select private.is_mentor()));

create policy "Mentors see and change who's active"
  on public.roster_students for all to authenticated
  using ((select private.is_mentor()))
  with check ((select private.is_mentor()));

create policy "Mentors see and change who's on each subteam"
  on public.roster_subteam_members for all to authenticated
  using ((select private.is_mentor()))
  with check ((select private.is_mentor()));

-- Everyone else: only their own entry, read-only, while their access is on.
create policy "Members see whether they're active"
  on public.roster_students for select to authenticated
  using ((select private.is_member()) and member_id = (select auth.uid()));

create policy "Members see their own subteams"
  on public.roster_subteam_members for select to authenticated
  using ((select private.is_member()) and member_id = (select auth.uid()));

-- The team's subteams to start with. Mentors can rename, add and remove them.
-- The ids match the example rows in src/modules/roster/data.ts.
insert into public.roster_subteams (id, name, position) values
  ('00000000-0000-4000-8000-00b100000001', 'Electrical', 1),
  ('00000000-0000-4000-8000-00b100000002', 'Mechanical', 2),
  ('00000000-0000-4000-8000-00b100000003', 'Software', 3),
  ('00000000-0000-4000-8000-00b100000004', 'Strategy', 4);
