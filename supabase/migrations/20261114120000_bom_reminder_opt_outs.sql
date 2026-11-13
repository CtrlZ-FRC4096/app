-- Slack reminders about BOM stages (issue #22): people can turn off their
-- daily reminder.
--
-- Everyone with open stages assigned to them gets a daily Slack message
-- listing them (src/modules/bom/reminders.ts). A row here means "this
-- person turned theirs off". Turning it back on deletes the row. So most
-- people have no row at all, and new people get reminders without doing
-- anything.
--
-- The rules:
--   - People see, add and remove only their own row. Not even mentors see
--     anyone else's: it's a personal setting.
--   - Nobody can change a row, so a row can't be moved to someone else.
--   - People whose access is switched off, and anyone signed out, get
--     nothing.
--
-- The scheduled reminders (scripts/slack-reminders.ts) read every row,
-- because they sign in to the database as its owner, which permission
-- rules don't apply to. They only read: see tablesQuery() in
-- src/core/reminders.ts.
--
-- If a person is deleted from the team, their row goes too.

create table public.bom_reminder_opt_outs (
  id uuid primary key default gen_random_uuid(),
  -- One row per person at most: unique.
  member_id uuid not null unique default auth.uid() references public.members (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.bom_reminder_opt_outs enable row level security;

-- Signed-out visitors get nothing. Signed-in people get what the rules allow.
revoke all on table public.bom_reminder_opt_outs from anon, authenticated;
grant select, insert, delete on table public.bom_reminder_opt_outs to authenticated;

-- So the switch on the BOM page changes straight away on your other devices.
alter publication supabase_realtime add table public.bom_reminder_opt_outs;

create policy "People see their own reminder setting"
  on public.bom_reminder_opt_outs for select to authenticated
  using (member_id = (select auth.uid()) and (select private.is_member()));

create policy "People turn off their own reminder"
  on public.bom_reminder_opt_outs for insert to authenticated
  with check (member_id = (select auth.uid()) and (select private.is_member()));

create policy "People turn their own reminder back on"
  on public.bom_reminder_opt_outs for delete to authenticated
  using (member_id = (select auth.uid()) and (select private.is_member()));

-- No update rule, so nobody can change a row, only add or remove their own.
