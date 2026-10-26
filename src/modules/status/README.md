# Robot status

**Not built yet.** Where each subsystem stands, and what has to happen before the next event.

## What it needs to do

- A grid of subsystems by stage: design, built, wired, programmed, tested
- A pit checklist for event day
- Tiles showing each other module's summary (low stock, short BOM lines, and so on)
- A big-screen view for the pit TV

## Rules

- Build the summary tiles from the module list (`src/modules/index.ts`) using each module's `useSummary` hook, so a new module appears without any change here.

## Where to start

1. Create `data.ts` with example subsystems and stages, and a function to move a stage along, with tests.
2. Show the grid; tapping a cell moves it to the next stage.
3. Add the pit checklist.

Copy the pattern from the [Example module](../example/README.md): a table
and rules in `data.ts`, tests in `data.test.ts`, and the page calling
`data.ts`. Each table also needs a migration in `supabase/migrations/` that
makes it in the team database, with its permission rules and tests; see
[Adding a module](../../../docs/adding-a-module.md). Keep each pull request to
one step.

**Works with:** Every module, through their `useSummary` hooks.
