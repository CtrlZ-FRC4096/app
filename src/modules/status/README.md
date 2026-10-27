# Robot status

The pit checklist is available as a **local preview**. Open Robot status to check
and uncheck items, add new items, and see how many are complete. Items and checks
survive a reload in the same browser when storage is available. They are not shared
with other team members. “Reset example data” restores the starter checklist.

Drag the handle at the right edge of an item to reorder it with a mouse or touch.
Keyboard users can focus the handle and press Up or Down. The destination row is
previewed while dragging: the lifted item follows your pointer and nearby rows
slide into place. Drops settle smoothly, with automatic scrolling at the viewport
edges. Reduced-motion preferences disable row transitions. Releasing outside the
list cancels the move. Mentors
open the three-dot menu for Person assignment and a Rename button; Escape closes
the menu. Person selections and subgroup membership edits save immediately with no
save button. Clearing everyone leaves the item unassigned. Rename opens a separate
popup with a name field and Rename button. Renaming keeps assignments, completion and order. The Other tools area
reserves space for future tools.
Each item displays a colored subgroup tag beside its name: General, Mechanical,
Electrical, Programming, or Drive team. Choose a subgroup when adding an item;
mentors can click the tag to change it in a separate popup. Picking a subgroup
saves immediately and closes the popup. Existing preview items show
General until a subgroup is chosen.
Click a tag to open its subgroup picker directly (mentors and admins). Assignment
pickers show only active members of that subgroup; General includes all active
members. This local preview starts with made-up subgroup associations. Mentors
can edit them under Person assignment > Edit subgroup members. Changing a tag or
removing a subgroup member removes incompatible assignments and clears completion
if an assigned person was removed. Membership edits apply to every matching item
in this browser and persist across reloads.
Choose one or more active team members when
adding an item. Only assigned people can check or uncheck it; mentors and admins
can reassign existing items, which marks them incomplete. Older saved items are
preserved as unassigned until a mentor assigns them. The demo View as switch lets
you try Alex (Student), Pat (Mentor), and Morgan (Admin). These are browser-only
checks, not database security; shared use requires database permission rules.

This preview intentionally uses a browser store in `data.ts` rather than a team
table. Shared storage needs mentor approval for a new migration and permission
tests in `supabase/`. The subsystem grid, summary tiles and TV view are not built yet.

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
