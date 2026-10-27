-- Points periods: the dates attendance points are counted over, like
-- "2027 build season, Jan 9 to Apr 17". Everyone starts each period with
-- the base points, and only meetings inside it count. Mentors save them
-- here so they all see the same points; the Attendance tab opens on the
-- period that includes today.
--
-- Mentors and admins only, like the rest of attendance.

create table public.attendance_periods (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 80),
  first_day date not null,
  -- Empty means the period is still going.
  last_day date check (last_day >= first_day),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.members (id) on delete set null
);

create unique index attendance_periods_name on public.attendance_periods (lower(trim(name)));

alter table public.attendance_periods enable row level security;
revoke all on table public.attendance_periods from anon, authenticated;
grant select, insert, update, delete on table public.attendance_periods to authenticated;
alter publication supabase_realtime add table public.attendance_periods;

create policy "Mentors manage points periods"
  on public.attendance_periods for all to authenticated
  using ((select private.is_mentor()))
  with check ((select private.is_mentor()));
