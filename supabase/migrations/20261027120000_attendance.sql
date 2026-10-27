-- Attendance: who said they'd come (the Slack poll), when they checked in
-- and out (Jibble), and the points that come from both. The Attendance
-- module imports these from a Slack export, and mentors fix mistakes by hand.
--
-- Mentors and admins only. Attendance is personal information about
-- students, so nobody else can read or change any of it.

-- Everyone who appears in the attendance channel. Most people have a Slack
-- user ID; someone only Jibble knows about may have just a name.
create table public.attendance_people (
  id uuid primary key default gen_random_uuid(),
  slack_user_id text unique,
  name text not null check (char_length(trim(name)) > 0),
  -- Hidden people (mentors, parents) stay in the data but not in the points table.
  hidden boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.members (id) on delete set null
);

-- Each check-in and check-out.
create table public.attendance_checks (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.attendance_people (id) on delete cascade,
  direction text not null check (direction in ('in', 'out')),
  at timestamptz not null,
  source text not null default 'manual' check (source in ('jibble', 'manual')),
  -- Set instead of deleting an imported check, so importing again doesn't bring it back.
  ignored boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.members (id) on delete set null,
  unique (person_id, direction, at)
);

-- Whether someone said they'd come on a day. One answer per person per day.
create table public.attendance_rsvps (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.attendance_people (id) on delete cascade,
  day date not null,
  coming boolean not null,
  -- Importing again updates poll answers but never overwrites a mentor's manual one.
  source text not null default 'manual' check (source in ('poll', 'manual')),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.members (id) on delete set null,
  unique (person_id, day)
);

alter table public.attendance_people enable row level security;
alter table public.attendance_checks enable row level security;
alter table public.attendance_rsvps enable row level security;

revoke all on table public.attendance_people, public.attendance_checks, public.attendance_rsvps from anon, authenticated;
grant select, insert, update, delete on table public.attendance_people, public.attendance_checks, public.attendance_rsvps to authenticated;

alter publication supabase_realtime add table public.attendance_people, public.attendance_checks, public.attendance_rsvps;

-- Mentors and admins can do everything; nobody else can do anything.
create policy "Mentors manage attendance people"
  on public.attendance_people for all to authenticated
  using ((select private.is_mentor()))
  with check ((select private.is_mentor()));

create policy "Mentors manage check-ins"
  on public.attendance_checks for all to authenticated
  using ((select private.is_mentor()))
  with check ((select private.is_mentor()));

create policy "Mentors manage RSVPs"
  on public.attendance_rsvps for all to authenticated
  using ((select private.is_mentor()))
  with check ((select private.is_mentor()));
