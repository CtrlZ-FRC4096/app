# Build progress

A grid of the robot's subsystems by stage: Design, Built, Wired,
Programmed and Tested. Each cell is Not started, In progress or Done.

It used to be at the top of Robot status, in the Competition menu. It moved
here, under Build, in #65 (step 1). Robot status kept the pit checklist.

## What works

- The grid is saved in the team database (#65, step 2), so everyone sees
  the same grid and it's still there after a reload.
- **Student leaders, mentors and admins** tap a cell to move it along: Not
  started → In progress → Done → Not started. They also get **Add a
  subsystem**, and under each subsystem's name **↑ ↓** to reorder it,
  **Rename** and **Remove** (two presses).
- **Students** see the grid, but the cells aren't buttons, with a note
  saying student leaders and mentors update it.
- On a phone the grid scrolls sideways inside its box; the page doesn't.

## How it's saved

The `build_subsystems` table (`supabase/migrations/..._build_subsystems.sql`):
one row per subsystem, with its name, its `position` on the grid, and
`stages`, each stage's state by name, like `{"Design": "Done"}`. A stage
that isn't there is Not started.

The stages are `STAGES` in `data.ts`, not columns in the table, so adding
or renaming a stage needs no migration. (Renaming a stage in `STAGES`
would start it again from Not started, since saved rows use the old name.)

Who can do what is in the migration's rules: everyone on the team reads the
grid; only `private.is_leader()` (student leaders, mentors and admins)
adds, changes and removes. Students are refused by the database too, not
just by the page. The rules are tested in
`supabase/tests/build-subsystems.test.ts`; the functions in `data.ts` are
tested in `data.test.ts`.

#65 first said anyone on the team could change a cell. It was decided
that only student leaders and above change it.

## Still to decide, with a mentor

- **Should the grid use the BOM's systems** (Intake, Drivetrain, … in
  `bom_systems`), so the team names each system once? #23 plans progress
  dashboards for those same systems.

Copy the pattern from the [Example module](../example/README.md). Keep each
pull request to one step.
