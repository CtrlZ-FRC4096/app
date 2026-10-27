-- The BOM module's tables: robots, the systems they're made of (Intake,
-- Drivetrain, ...), and the parts in each system.
--
-- For now the rows are typed in. Importing them from Onshape comes later.
--
-- Members can read everything, and add parts. Only mentors can change and
-- delete parts, and add, change and delete robots and systems.
-- The helpers private.is_member() and private.is_mentor() come from the
-- members migration.

-- Robots, such as "2026 competition robot".
create table public.bom_robots (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 100),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.members (id) on delete set null
);

-- The systems a robot is made of. Deleting a robot deletes its systems.
create table public.bom_systems (
  id uuid primary key default gen_random_uuid(),
  robot_id uuid not null references public.bom_robots (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  -- The short code used in part numbers, such as INT in 4096-26-INT-001.
  code text not null check (code ~ '^[A-Z]{2,4}$'),
  onshape_url text check (onshape_url like 'https://%'),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.members (id) on delete set null,
  unique (robot_id, code),
  unique (robot_id, name)
);

create index on public.bom_systems (robot_id);

-- The parts in a system. Deleting a system deletes its parts.
-- Made parts need a material; COTS (bought) parts need a vendor.
create table public.bom_parts (
  id uuid primary key default gen_random_uuid(),
  system_id uuid not null references public.bom_systems (id) on delete cascade,
  part_number text not null unique check (char_length(part_number) between 1 and 40),
  name text not null check (char_length(name) between 1 and 100),
  revision text check (char_length(revision) between 1 and 10),
  kind text not null check (kind in ('made', 'cots')),
  material text check (char_length(material) between 1 and 100),
  quantity integer not null check (quantity >= 1),
  vendor text check (char_length(vendor) between 1 and 100),
  vendor_part_number text check (char_length(vendor_part_number) between 1 and 100),
  onshape_url text check (onshape_url like 'https://%'),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.members (id) on delete set null,
  check ((kind = 'made' and material is not null) or (kind = 'cots' and vendor is not null))
);

create index on public.bom_parts (system_id);

alter table public.bom_robots enable row level security;
alter table public.bom_systems enable row level security;
alter table public.bom_parts enable row level security;

-- Signed-out visitors get nothing. Signed-in people get what the rules allow.
revoke all on table public.bom_robots, public.bom_systems, public.bom_parts from anon, authenticated;
grant select, insert, update, delete on table public.bom_robots, public.bom_systems, public.bom_parts to authenticated;

-- Changes from other people show up in the app straight away.
alter publication supabase_realtime add table public.bom_robots, public.bom_systems, public.bom_parts;

-- The rules. Wrapping the helpers in (select ...) lets the database work out
-- the answer once per query instead of once per row.

-- Robots
create policy "Members can read robots"
  on public.bom_robots for select to authenticated
  using ((select private.is_member()));

create policy "Mentors can add robots"
  on public.bom_robots for insert to authenticated
  with check ((select private.is_mentor()) and created_by = (select auth.uid()));

create policy "Mentors can change robots"
  on public.bom_robots for update to authenticated
  using ((select private.is_mentor()))
  with check ((select private.is_mentor()));

create policy "Mentors can delete robots"
  on public.bom_robots for delete to authenticated
  using ((select private.is_mentor()));

-- Systems
create policy "Members can read systems"
  on public.bom_systems for select to authenticated
  using ((select private.is_member()));

create policy "Mentors can add systems"
  on public.bom_systems for insert to authenticated
  with check ((select private.is_mentor()) and created_by = (select auth.uid()));

create policy "Mentors can change systems"
  on public.bom_systems for update to authenticated
  using ((select private.is_mentor()))
  with check ((select private.is_mentor()));

create policy "Mentors can delete systems"
  on public.bom_systems for delete to authenticated
  using ((select private.is_mentor()));

-- Parts
create policy "Members can read parts"
  on public.bom_parts for select to authenticated
  using ((select private.is_member()));

create policy "Members can add parts as themselves"
  on public.bom_parts for insert to authenticated
  with check ((select private.is_member()) and created_by = (select auth.uid()));

create policy "Mentors can change parts"
  on public.bom_parts for update to authenticated
  using ((select private.is_mentor()))
  with check ((select private.is_mentor()));

create policy "Mentors can delete parts"
  on public.bom_parts for delete to authenticated
  using ((select private.is_mentor()));
