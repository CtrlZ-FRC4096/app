# BOM

The bill of materials for each robot, checked against Inventory, so the team can see what to make and what to order.

**Built so far:** a robot is made of systems (Intake, Drivetrain, …), and each system has a list of parts. The page shows one system's parts with an All / Custom / COTS filter. Student leaders, mentors and admins can add, change and delete parts, and import a system's parts from Onshape (see [Who can do what](#who-can-do-what)). Custom parts (made in our shop) show their stages (see below). COTS parts show their order from Purchasing, or a **Purchase** button that opens a request there, filled in from the part. COTS parts also show how many Inventory has on the shelf and where, and how many are missing or being ordered (see below).

| File | What it does |
|:--|:--|
| `index.ts` | Tells the app about the module, and puts "2 systems · 12 parts" on the home page tile. |
| `data.ts` | The four tables (`bom_robots`, `bom_systems`, `bom_parts`, `bom_steps`), their example rows, adding and changing them, moving stages along, and reading a system from Onshape. |
| `onshape.ts` | Works out what an import from Onshape changes: `planOnshapeImport()`. |
| `data.test.ts`, `onshape.test.ts` | Tests for both. |
| `BomPage.tsx` | Pick a system, then see its parts in a table with their stages, change them, and import from Onshape. |

The tables are made by `supabase/migrations/20261027150000_bom.sql`, and their permission rules are tested in `supabase/tests/bom.test.ts`.

## Who can do what

| | Students | Student leaders, mentors and admins |
|:--|:--|:--|
| See everything | Yes | Yes |
| Add and change systems | Yes | Yes |
| Choose a part's stages, and move stages along | Yes | Yes |
| Add and rename robots | | Yes |
| Add, change and delete parts | | Yes |
| Import from Onshape | | Yes |
| Delete a system (and every part in it) | | Yes |

The rules are in `supabase/migrations/20261110130000_bom_student_leaders.sql` (using `private.is_leader()`), and tested in `supabase/tests/bom.test.ts` and `bom-steps.test.ts`. In the app, `canEditRobotsAndParts()` in `data.ts` decides which buttons a student sees, and the functions in `data.ts` explain who to ask.

**Custom and COTS.** Custom parts are made in our shop; COTS parts are bought. The page calls them Custom, but the database still stores them as `made`, so no migration was needed for the name.

**Part numbers.** Every part gets a team number like `4096-26-INT-001`: team, year, system code, then a number. Custom parts also have a material, such as "6061 aluminum, 1/4 in plate". COTS (bought) parts have a vendor and the vendor's part number.

## Stages

Every custom part goes through stages before it's on the robot (#15): **Design → Pre-process → Process 1 → Process 2 → Post-process**. A part only has the stages it needs.

- **Pre-process:** cutting stock to size, or CAM.
- **Process 1 and 2:** a machine each: CNC router, lathe, mill, 3D printer, laser or hand tools. On the page they're shown by their machine, like "Lathe".
- **Post-process:** deburring, tapping, finishing.

Under each custom part, each stage shows its status (To do, In progress, Done) and how many of the part's quantity are through it ("1 of 3"). Anyone on the team, students too, can count parts through with − and +, which never goes below 0 or above the part's quantity, and move a stage along with **Start** and **Mark done** (**Undo** goes back one). Anyone can choose a part's stages with **Change stages**.

The **station filter** shows one station's queue: "Lathe only" lists the parts with a lathe stage that isn't done, and "Waiting for post-process" the parts whose post-process isn't done.

The table is made by `supabase/migrations/20261102120000_bom_steps.sql`, with its rules tested in `supabase/tests/bom-steps.test.ts`: anyone on the team can read, add and remove stages, and change their status and how many are done. Deleting a part deletes its stages.

The CNC board tracks routing separately (Ready to CAM → To cut → Cutting → Cut), so for now a part's CNC router stage is moved along by hand here too.

## On the shelf

Under each COTS part, the page shows what Inventory has, in plain text: "On the shelf: 4 · Bin M1", or "Not in Inventory". Then either:

- the quantity on the part's request in Purchasing, with how far along it is (`orderWord()`): **"Ordering 3"** while it's still being asked for (Wait to Order and the Order statuses), **"Ordered 3"** once it's placed (Order Placed, Backordered), and **"Received 3"** once it's Received or In Shop; or
- **"Missing 2"** when there's no request, or it was cancelled or is Out of Stock (so it couldn't be ordered), and the shelf has fewer than the line needs. Nothing is added when there are enough.

 `shelfItem()` in `data.ts` finds the Inventory part with the same **vendor part number**, ignoring capitals and spaces. Vendor names only decide when two Inventory parts have the same number, because the team writes them differently ("REV" and "REV Robotics"). Missing compares the shelf with that one line's quantity. It doesn't yet add up the same part used in more than one system (#17).

## Importing from Onshape

Student leaders, mentors and admins import. Students can add a system's Onshape link, then ask one of them.

1. **Link the system.** Open the system's assembly (or Part Studio) in Onshape, copy the address, and paste it into **Change system > Onshape link**.
2. **Import from Onshape** reads its parts through the `onshape` server function (`supabase/functions/onshape/`), which holds the team's Onshape keys. Sub-assemblies are flattened into one list.
3. The page shows what will change before anything is saved. **Import** makes the changes:
   - **New parts are added.** A custom part keeps its Onshape part number if no other part has it; otherwise it gets the next team number. Standard content (bolts, nuts) and parts with a vendor are COTS: Onshape's part number becomes the vendor's part number, and they get a team number too.
   - **Changed names, quantities, materials and revisions are updated.** Where Onshape has nothing (no material set yet, say), what's in the app stays.
   - **Parts no longer in Onshape are marked "Removed in Onshape"**, not deleted, so their history stays. If they come back, the mark goes.

Parts are matched by which Onshape part they are (`onshape_id`), never by name, so renaming a part in CAD keeps it. The first time, a part typed in by hand is matched if Onshape has the same part number. Parts imported from Onshape can have no material or vendor yet.

The example Intake in demo mode is linked to a made-up assembly, so **Import from Onshape** shows how it works without keys. The import columns are added by `supabase/migrations/20261028090000_bom_onshape_import.sql`.

## Still to do

- Write team part numbers into Onshape (#21)
- Add up a bought part used in more than one system, and a To order list (#17)
- Assign stages to people, with due dates (#16)
- Move a part's CNC router stage along when the CNC board marks it cut
- Mentors mark short parts as ordered
- Costs, visible only to mentors and admins

## Rules

- The Onshape keys can open all of the team's CAD. Anything that talks to Onshape goes in the `onshape` server function, never in the browser, and changes to it need a mentor's review.
- Onshape limits API calls per year: only call Onshape when someone asks, never when a page opens.
- Costs are hidden from students.
- Read stock levels through Inventory's `data.ts`, not by copying its data.

Copy the pattern from the [Example module](../example/README.md). Keep each pull request to one step.

**Works with:** Inventory (stock levels), Robot status (shows the short-line count).
