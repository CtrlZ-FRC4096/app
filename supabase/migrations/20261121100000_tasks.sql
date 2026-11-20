-- The Task board's table (#157): general jobs for students that aren't on
-- the BOM or the pit checklist, like "Sort the hardware bins", each in a
-- subteam and given to one or more people.
--
-- Who can do what:
--   members                         see every task
--   students                        move a task assigned to them along
--                                   (To do, In progress, Done), and only
--                                   change its status
--   student leaders, mentors,       add, edit, assign, delete and move any
--   admins                          task
--
-- The update rule below lets students touch only their own tasks, and the
-- trigger keeps them to the status. A column grant can't do that, because
-- it would stop leaders too (the same reason as ..._batteries.sql).
--
-- private.is_member() is from the members migration, and private.is_leader()
-- (student leaders, mentors and admins) is from ..._student_leaders.sql.

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  -- What needs doing. The app allows the same lengths (TITLE_LIMIT and
  -- DETAILS_LIMIT in src/modules/tasks/data.ts).
  title text not null check (char_length(title) between 1 and 120),
  details text not null default '' check (char_length(details) <= 1000),
  -- General, Mechanical, Electrical, Programming or Drive team. The list is
  -- SUBTEAMS in src/modules/tasks/data.ts, so it isn't fixed here (like the
  -- pit checklist's subgroup).
  subteam text not null default 'General' check (char_length(subteam) between 1 and 40),
  -- Who the task is for: members' ids, or nobody yet. An array, like the pit
  -- checklist's, so the update rule can ask "is this person on the task?" in
  -- one step. An array can't have a foreign key, so a removed member's id can
  -- stay; the app shows them as "A former member".
  assignee_ids uuid[] not null default '{}',
  -- No due date is null.
  due_date date,
  status text not null default 'todo' check (status in ('todo', 'in_progress', 'done')),
  -- When it was marked done, for "Show done" (newest first). The trigger
  -- below sets it, and clears it when the task is moved back.
  done_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.members (id) on delete set null
);

alter table public.tasks enable row level security;

-- Signed-out visitors get nothing. Signed-in people get what the rules allow.
revoke all on table public.tasks from anon, authenticated;
grant select, insert, update, delete on table public.tasks to authenticated;

-- A student marking a task done shows up on a leader's phone straight away.
alter publication supabase_realtime add table public.tasks;

-- The rules. Wrapping the helpers in (select ...) lets the database work out
-- the answer once per query instead of once per row.

create policy "Members can see every task"
  on public.tasks for select to authenticated
  using ((select private.is_member()));

create policy "Leaders can add tasks as themselves"
  on public.tasks for insert to authenticated
  with check ((select private.is_leader()) and created_by = (select auth.uid()));

-- Students only reach tasks they're on. Changing someone else's task changes
-- nothing. The trigger below keeps them to the status.
create policy "Leaders can change any task, and members move their own along"
  on public.tasks for update to authenticated
  using ((select private.is_leader()) or ((select private.is_member()) and (select auth.uid()) = any (assignee_ids)))
  with check ((select private.is_leader()) or ((select private.is_member()) and (select auth.uid()) = any (assignee_ids)));

create policy "Leaders can delete tasks"
  on public.tasks for delete to authenticated
  using ((select private.is_leader()));

-- Before every new or changed task: done_at is the database's own time when
-- the status becomes Done, and empty otherwise, so a phone with the wrong
-- time can't get it wrong. On a change, only leaders change anything but the
-- status. Comparing every other column means a column added later is covered
-- too. Like the batteries trigger, it only limits people using the app, not
-- changes made in the SQL editor.
create function private.before_task_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.done_at := case when new.status = 'done' then now() end;
    return new;
  end if;
  if auth.uid() is not null
    and not private.is_leader()
    and (to_jsonb(new) - 'status' - 'done_at') is distinct from (to_jsonb(old) - 'status' - 'done_at')
  then
    raise exception 'Only student leaders, mentors and admins can change a task''s title, details, subteam, people or due date. You can move your own tasks along.';
  end if;
  if new.status is not distinct from old.status then
    new.done_at := old.done_at;
  elsif new.status = 'done' then
    new.done_at := now();
  else
    new.done_at := null;
  end if;
  return new;
end;
$$;

revoke all on function private.before_task_change() from public;

create trigger before_task_change
  before insert or update on public.tasks
  for each row execute function private.before_task_change();
