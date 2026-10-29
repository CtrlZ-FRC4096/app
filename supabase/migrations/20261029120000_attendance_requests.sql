-- Requests for missing hours: anyone on the team asks for hours Jibble
-- missed (a forgotten check-out, or a session they didn't check in for),
-- and mentors and admins approve or decline them.
--
-- Approving adds the check-in and check-out to attendance_checks here, in
-- the database, in the same step as marking the request approved, so hours
-- and points update straight away and nothing is typed in twice.

create table public.attendance_requests (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.attendance_people (id) on delete cascade,
  -- The meeting day the hours are for.
  day date not null,
  -- When they say they checked in and out. One can be left out: a
  -- forgotten check-out only needs the check-out.
  in_at timestamptz,
  out_at timestamptz,
  -- What happened, for the mentor deciding.
  note text not null check (char_length(trim(note)) between 1 and 300),
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.members (id) on delete set null,
  -- Who approved or declined it, and when. Filled in by the trigger below.
  decided_at timestamptz,
  decided_by uuid references public.members (id) on delete set null,
  check (in_at is not null or out_at is not null),
  check (in_at is null or out_at is null or out_at > in_at),
  -- Both times are on the day asked about, in Central time like the rest of attendance.
  check (in_at is null or (in_at at time zone 'America/Chicago')::date = day),
  check (out_at is null or (out_at at time zone 'America/Chicago')::date = day)
);

-- One waiting request per person per day.
create unique index attendance_requests_one_waiting on public.attendance_requests (person_id, day) where status = 'pending';

alter table public.attendance_requests enable row level security;

-- People can only ever write these columns. Mentors decide by changing
-- status (and can correct the times first); the trigger fills in the rest.
revoke all on table public.attendance_requests from anon, authenticated;
grant select, delete on table public.attendance_requests to authenticated;
grant insert (person_id, day, in_at, out_at, note) on table public.attendance_requests to authenticated;
grant update (status, in_at, out_at) on table public.attendance_requests to authenticated;

alter publication supabase_realtime add table public.attendance_requests;

create policy "Mentors see and decide every request"
  on public.attendance_requests for all to authenticated
  using ((select private.is_mentor()))
  with check ((select private.is_mentor()));

-- Everyone else: only requests about their own attendance (matched by
-- Slack account, see private.my_attendance_people()).
create policy "Members see their own requests"
  on public.attendance_requests for select to authenticated
  using (person_id in (select private.my_attendance_people()));

create policy "Members ask about their own hours"
  on public.attendance_requests for insert to authenticated
  with check (person_id in (select private.my_attendance_people()));

create policy "Members take back their own waiting requests"
  on public.attendance_requests for delete to authenticated
  using (person_id in (select private.my_attendance_people()) and status = 'pending');

-- When a mentor approves or declines: record who and when, and on
-- approval add the times to attendance_checks as check-ins made by hand.
-- A request can only be decided once. Runs with the owner's rights so it
-- can add the checks; only mentors can change status, so only they get here.
create function private.decide_attendance_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status <> 'pending' then
    if new.status is distinct from old.status or new.in_at is distinct from old.in_at or new.out_at is distinct from old.out_at then
      raise exception 'That request was already %. Fix the hours by choosing the person instead.', old.status;
    end if;
    return new;
  end if;

  if new.status is distinct from old.status then
    new.decided_at := now();
    new.decided_by := auth.uid();
    if new.status = 'approved' then
      insert into public.attendance_checks (person_id, direction, at, source, created_by)
      select new.person_id, d.direction, d.at, 'manual', auth.uid()
      from (values ('in', new.in_at), ('out', new.out_at)) as d (direction, at)
      where d.at is not null
      -- The same time is already there: count it, even if it was ignored.
      on conflict (person_id, direction, at) do update set ignored = false;
    end if;
  end if;
  return new;
end;
$$;

create trigger decide_attendance_request
  before update on public.attendance_requests
  for each row execute function private.decide_attendance_request();
