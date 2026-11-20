# Task board

One place to give students general jobs that aren't on the BOM or the pit
checklist, like "Sort the hardware bins", "Update the drive code README" or
"Re-crimp the PDH connectors", grouped by subteam (#157). It's in the Team
menu.

## What it does

- **My tasks**, at the top: your own unfinished tasks, soonest due first
  (late ones come first), each with a big button to move it along: **Start**,
  then **Mark done**. With none, it says "Nothing assigned to you".
- **The board**: a column for each subteam (General, Mechanical, Electrical,
  Programming, Drive team), side by side on a wide screen and stacked on a
  phone. Each task shows its status, who it's for ("Nobody yet" if nobody),
  its due date, and who added it.
- **Late** shows on any task that isn't done and is past its due date. Due
  today isn't late yet.
- **Show done** shows the finished tasks too, the most recently done first.
  They're tucked away to start with. **Not done yet** moves a done task back
  to In progress, to undo a mis-tap.
- **Subteam** picks one column, and **Find a task** searches titles,
  details and people's names.
- Student leaders, mentors and admins get **Add a task**, and **Edit** and
  **Delete** on every task. Delete takes two presses.
- **The home page tile** says "3 tasks for you · 1 due today", in the
  warning colour if any are late. A student leader, mentor or admin with no
  tasks of their own sees how many are open on the board. **Needs
  attention** lists your own late tasks.

## Who can do what

| | Students | Student leaders, mentors, admins |
|:--|:--|:--|
| See tasks | Yes, all of them | Yes |
| Change the status of a task **assigned to them** | Yes | Yes, any task |
| Add, edit, assign, delete tasks | No | Yes |

Students can't take a task nobody has yet: a student leader or mentor gives
it to them. A student who tries something else is told who to ask, like
"Ask a student leader or mentor to add tasks." The page decides who sees
what with `canManageTasks()` (which is `isLeader()`) and `canMoveAlong()` in
`data.ts`. Hiding the buttons is only tidiness: the database's rules below
are what stop anyone else.

## Where it's saved

The `tasks` table, made by `supabase/migrations/20261121100000_tasks.sql`:

- Everyone on the team can see every task.
- Only student leaders, mentors and admins (`private.is_leader()`) can add
  and delete tasks.
- The update rule lets leaders change any task, and students only tasks
  they're on. A trigger keeps students to the status: changing a task's
  title, details, subteam, people or due date gives "Only student leaders,
  mentors and admins can change…".
- The same trigger sets `done_at` to the database's own time when a task is
  marked done, and clears it when it's moved back. Show done uses it for
  "most recently done first".
- A title is at most 120 characters and details at most 1000, in the
  database and in the form (`TITLE_LIMIT` and `DETAILS_LIMIT`).

The tests in `supabase/tests/tasks.test.ts` show who can and can't do each
thing.

**Needs a mentor's approval:** the migration and its tests, and registering
the module in `src/modules/index.ts`.

## Subteams

`SUBTEAMS` in `data.ts` uses the same names as the pit checklist, so the
team names them the same everywhere (a test checks they match). The
database doesn't fix the list, so changing it needs no migration. A task
whose subteam is taken off the list still shows, in its own column at the
end of the board; editing it makes a leader pick a listed subteam.

## Choosing people

The form uses `PeoplePicker` from `src/core/ui.tsx`. Anyone whose access is
on can be given a task. Nobody is listed until you type a name in **Find
someone**, so the list isn't the whole team. Someone already on a task stays
on it if their access is switched off later, until a leader takes them off.
A removed member shows as "A former member".

## Demo mode

Made-up tasks for the made-up people in `DEMO_PEOPLE`, with due dates
counted from the day you first open it ("Reset example data" refreshes
them). Viewing as Student (Alex) shows a late task and one due today; view
as Student leader to add, edit and delete.

## Later, not built yet

- A Task board switch on the Notifications page (#155), for when you're
  given a task or one is due.
- Saving who's in each subteam, so "give it to the whole Electrical
  subteam" works.
- More subteams (Business, Outreach, CAD, …): decide with a mentor.
- Letting students take a task nobody has yet.
