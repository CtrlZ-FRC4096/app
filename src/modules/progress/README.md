# Build progress

**Partly built.** A grid of the robot's subsystems by stage: Design, Built,
Wired, Programmed and Tested. Tapping a cell moves it along: Not started →
In progress → Done → Not started.

It used to be at the top of Robot status, in the Competition menu. It moved
here, under Build, in #65 (step 1). Robot status kept the pit checklist.

## What works so far

- The grid, with the subsystems (`SUBSYSTEMS`) and stages (`STAGES`) from `data.ts`
- `advanceStage()` in `data.ts` moves one cell along, with tests in `data.test.ts`
- On a phone the grid scrolls sideways inside its box; the page doesn't

**Not saved yet.** Changes reset when you leave or reload the page, and
nobody else sees them.

## What it needs to do (#65, step 2)

- Save the grid in a table (such as `build_subsystems`) so it's shared with
  the team and survives a reload. That needs a migration, permission tests
  and example rows for demo mode, and changes in `supabase/` need a
  mentor's approval.
- Anyone on the team can change a cell.
- Mentors add, rename and remove subsystems.

Decide these first, with a mentor:

- **Who adds subsystems:** mentors only, or anyone on the team?
- **Should the grid use the BOM's systems** (Intake, Drivetrain, … in
  `bom_systems`), so the team names each system once? #23 plans progress
  dashboards for those same systems.

Copy the pattern from the [Example module](../example/README.md). Keep each
pull request to one step.
