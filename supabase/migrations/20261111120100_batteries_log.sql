-- The Batteries module's history: every status change and tester reading,
-- with who and when. Anyone on the team adds to it and reads it. Nobody
-- edits or deletes it, so it can be trusted after a brownout.
--
-- One row is one of:
--   kind 'status'   a battery moved to `status`; `match` says which match
--                   when it went In the robot
--   kind 'reading'  a tester reading: `voltage` and/or `resistance_ohms`
--
-- Deleting a battery (only mentors, for one added by mistake) deletes its
-- history with it. Retire a battery instead to keep its history.

create table public.batteries_log (
  id uuid primary key default gen_random_uuid(),
  battery_id uuid not null references public.batteries (id) on delete cascade,
  kind text not null check (kind in ('status', 'reading')),
  status text check (char_length(status) between 1 and 40),
  -- Like "Qual 12". Free text, since it can be a practice match.
  match text check (char_length(match) between 1 and 40),
  voltage numeric check (voltage > 0 and voltage < 20),
  -- Internal resistance, in ohms. A good battery is around 0.015.
  resistance_ohms numeric check (resistance_ohms > 0 and resistance_ohms < 1),
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid() references public.members (id) on delete cascade,
  check (
    (kind = 'status' and status is not null and voltage is null and resistance_ohms is null)
    or (kind = 'reading' and status is null and match is null and (voltage is not null or resistance_ohms is not null))
  )
);

create index batteries_log_battery on public.batteries_log (battery_id, created_at desc);

alter table public.batteries_log enable row level security;

-- Signed-out visitors get nothing. Members can only read and add: there's
-- no update or delete for anyone, so the history can't be changed.
revoke all on table public.batteries_log from anon, authenticated;
grant select, insert on table public.batteries_log to authenticated;

alter publication supabase_realtime add table public.batteries_log;

create policy "Members can read battery history"
  on public.batteries_log for select to authenticated
  using ((select private.is_member()));

create policy "Members can add to battery history as themselves"
  on public.batteries_log for insert to authenticated
  with check ((select private.is_member()) and created_by = (select auth.uid()));
