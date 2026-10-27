# BOM

The bill of materials for each robot, checked against Inventory, so the team can see what to make and what to order.

**Built so far:** a robot is made of systems (Intake, Drivetrain, …), and each system has a list of parts. The page shows one system's parts with an All / Made / COTS filter. Anyone on the team can add, change and delete parts, and import a system's parts from Onshape.

| File | What it does |
|:--|:--|
| `index.ts` | Tells the app about the module, and puts "2 systems · 12 parts" on the home page tile. |
| `data.ts` | The three tables (`bom_robots`, `bom_systems`, `bom_parts`), their example rows, adding and changing them, and reading a system from Onshape. |
| `onshape.ts` | Works out what an import from Onshape changes: `planOnshapeImport()`. |
| `data.test.ts`, `onshape.test.ts` | Tests for both. |
| `BomPage.tsx` | Pick a system, then see its parts in a table, change them, and import from Onshape. |

The tables are made by `supabase/migrations/20261027150000_bom.sql`, and their permission rules are tested in `supabase/tests/bom.test.ts`. Anyone on the team can add and change robots, systems and parts, and delete parts (`supabase/migrations/20261027170000_bom_members_edit.sql`). Only mentors can delete a system, because that deletes every part in it too.

**Part numbers.** Every part gets a team number like `4096-26-INT-001`: team, year, system code, then a number. Made parts also have a material, such as "6061 aluminum, 1/4 in plate". COTS (bought) parts have a vendor and the vendor's part number.

## Importing from Onshape

1. **Link the system.** Open the system's assembly (or Part Studio) in Onshape, copy the address, and paste it into **Change system > Onshape link**.
2. **Import from Onshape** reads its parts through the `onshape` server function (`supabase/functions/onshape/`), which holds the team's Onshape keys. Sub-assemblies are flattened into one list.
3. The page shows what will change before anything is saved. **Import** makes the changes:
   - **New parts are added.** A made part keeps its Onshape part number if no other part has it; otherwise it gets the next team number. Standard content (bolts, nuts) and parts with a vendor are COTS: Onshape's part number becomes the vendor's part number, and they get a team number too.
   - **Changed names, quantities, materials and revisions are updated.** Where Onshape has nothing (no material set yet, say), what's in the app stays.
   - **Parts no longer in Onshape are marked "Removed in Onshape"**, not deleted, so their history stays. If they come back, the mark goes.

Parts are matched by which Onshape part they are (`onshape_id`), never by name, so renaming a part in CAD keeps it. The first time, a part typed in by hand is matched if Onshape has the same part number. Parts imported from Onshape can have no material or vendor yet.

The example Intake in demo mode is linked to a made-up assembly, so **Import from Onshape** shows how it works without keys. The import columns are added by `supabase/migrations/20261028090000_bom_onshape_import.sql`.

## Still to do

- Write team part numbers into Onshape (#21)
- For bought parts: how many are on the shelf (from Inventory), and whether we're short
- For made parts: whether they have been made yet
- Mentors mark short parts as ordered
- Costs, visible only to mentors and admins

## Rules

- The Onshape keys can open all of the team's CAD. Anything that talks to Onshape goes in the `onshape` server function, never in the browser, and changes to it need a mentor's review.
- Onshape limits API calls per year: only call Onshape when someone asks, never when a page opens.
- Costs are hidden from students.
- Read stock levels through Inventory's `data.ts`, not by copying its data.

Copy the pattern from the [Example module](../example/README.md). Keep each pull request to one step.

**Works with:** Inventory (stock levels), Robot status (shows the short-line count).
