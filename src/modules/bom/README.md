# BOM

The bill of materials for each robot, checked against Inventory, so the team can see what to make and what to order.

**Built so far:** a robot is made of systems (Intake, Drivetrain, …), and each system has a list of parts. The page shows one system's parts with an All / Custom / COTS filter. Student leaders, mentors and admins can add, change and delete parts, and import a system's parts from Onshape (see [Who can do what](#who-can-do-what)). Custom parts (made in our shop) show their stages (see below). COTS parts show their order from Purchasing, or a **Purchase** button that opens a request there, filled in from the part. COTS parts also show how many Inventory has on the shelf and where, and how many are missing or being ordered (see below).

| File | What it does |
|:--|:--|
| `index.ts` | Tells the app about the module, and puts "2 systems · 12 parts" on the home page tile. |
| `data.ts` | The four tables (`bom_robots`, `bom_systems`, `bom_parts`, `bom_steps`), their example rows, adding and changing them, moving stages along, assigning them, and reading a system from Onshape. |
| `onshape.ts` | Works out what an import from Onshape changes: `planOnshapeImport()`. |
| `data.test.ts`, `onshape.test.ts` | Tests for both. |
| `BomPage.tsx` | Pick a system, then see its parts in a table with their stages, change them, and import from Onshape. Below, the robot's To order list. |

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

**A part's buttons.** Under each part's name and details is one row of buttons, always in this order (#172). A button that doesn't apply is left out, and on a phone the row wraps onto a second line.

| Button | Shows on | Does |
|:--|:--|:--|
| **Purchase**, or **Open in Purchasing** once there's a request | COTS parts | Opens a request in Purchasing filled in from the part, or the request it already has. Its status, **Late** and "Arrives Nov 12" sit just before it. |
| **Ready to CAM** | Custom parts | Puts the part on the CNC board. "2 on the CNC board" sits just before it. |
| **Open CAD ↗** | Parts with an Onshape link | Opens the part in Onshape in a new tab. |
| **Edit** | Every part, for student leaders, mentors and admins | Opens the part's form, to change or delete it. Tapping the name does too. |

Parts marked "Removed in Onshape" don't show Purchase or Ready to CAM.

Every form (a part, Ready to CAM, stages, assigning a stage) opens near the top of the page, above the parts list, and scrolls itself into view when it opens (`InView` from `src/core/ui.tsx`, which Purchasing uses too), so it's never out of sight (#170).

**Custom and COTS.** Custom parts are made in our shop; COTS parts are bought. The page calls them Custom, but the database still stores them as `made`, so no migration was needed for the name.

**Part numbers.** Every part gets a team number like `4096-26-INT-001`: team, year, system code, then a number. Custom parts also have a material, such as "6061 aluminum, 1/4 in plate". COTS (bought) parts have a vendor and the vendor's part number.

## Stages

Every custom part goes through stages before it's on the robot (#15): **Design → Pre-process → Process 1 → Process 2 → Post-process**. A part only has the stages it needs.

- **Pre-process:** cutting stock to size, or CAM.
- **Process 1 and 2:** a machine each: CNC router, lathe, mill, 3D printer, laser or hand tools. On the page they're shown by their machine, like "Lathe".
- **Post-process:** deburring, tapping, finishing.

Under each custom part, each stage shows its status (To do, In progress, Done) and how many of the part's quantity are through it ("1 of 3"). Anyone on the team, students too, can count parts through with − and +, which never goes below 0 or above the part's quantity, and move a stage along with **Start** and **Mark done** (**Undo** goes back one). Anyone can choose a part's stages with **Change stages**.

Each stage can be **assigned** to a person, with a due date (#16). Under a stage, **Assign** (or **Change**) picks who's doing it and when it's due; both can be left empty. A stage whose due date has passed and isn't done shows **Late**. Anyone on the team can assign stages. People whose access is switched off can't be given work.

The **station filter** shows one station's queue: "Lathe only" lists the parts with a lathe stage that isn't done, and "Waiting for post-process" the parts whose post-process isn't done.

The table is made by `supabase/migrations/20261102120000_bom_steps.sql`, with its rules tested in `supabase/tests/bom-steps.test.ts`: anyone on the team can read, add and remove stages, and change their status and how many are done. Deleting a part deletes its stages. The assignee and due date columns are added by `supabase/migrations/20261110140000_bom_steps_assign.sql`.

The CNC board tracks routing separately (Ready to CAM → To cut → Cutting → Cut), so for now a part's CNC router stage is moved along by hand here too.

## On the shelf

Under each COTS part, the page shows what Inventory has, in plain text: "On the shelf: 4 · Bin M1", or "Not in Inventory". Then either:

- the quantity on the part's request in Purchasing, with how far along it is (`orderWord()`): **"Ordering 3"** while it's still being asked for (Wait to Order and the Order statuses), **"Ordered 3"** once it's placed (Order Placed, Backordered), and **"Received 3"** once it's Received or In Shop; or
- **"Missing 2"** when there's no request, or it was cancelled or is Out of Stock (so it couldn't be ordered), and the shelf has fewer than the line needs. Nothing is added when there are enough.

 `shelfItem()` in `data.ts` finds the Inventory part with the same **vendor part number**, ignoring capitals and spaces. Vendor names only decide when two Inventory parts have the same number, because the team writes them differently ("REV" and "REV Robotics"). **A part used in more than one system is added up** (#17): `shortages()` in `data.ts` gives, for each COTS part in a robot, how many are needed across all its systems, how many are on the shelf, and how many short. So if the intake needs 6 of a bearing and the drivetrain 4, with 7 on the shelf, both lines say "Robot needs 10 in 2 systems · Missing 3". A part that isn't in Inventory is fully short.

## To order

At the bottom of the page, **To order** lists the COTS parts the whole robot is short of, grouped by vendor (#17). Each line shows how many the robot needs, how many are on the shelf, how many are already in Purchasing, and how many are left to order. **Copy as CSV** copies the list (vendor, vendor part number, part, quantity to order) to paste into a spreadsheet or an order.

`toOrder()` in `data.ts` builds it from `shortages()`. To stop a part being ordered twice, it takes off what's already on a request in Purchasing for those BOM lines. Requests that are cancelled or Out of Stock don't count. Requests that are In Shop don't count either: they're put away, so Inventory's count should include them. **If something is In Shop but Inventory wasn't updated, it shows here again**, so update Inventory when parts are put away. Vendors are named the way Purchasing names them (`vendorFor()`), so "REV" and "REV Robotics" are one group.

## Importing from Onshape

Student leaders, mentors and admins import. Students can add a system's Onshape link, then ask one of them.

1. **Link the system.** Open the system's assembly (or Part Studio) in Onshape, copy the address, and paste it into **Change system > Onshape link**.
2. **Import from Onshape** reads its parts through the `onshape` server function (`supabase/functions/onshape/`), which holds the team's Onshape keys. Sub-assemblies are flattened into one list.
3. The page shows what will change before anything is saved. **Import** makes the changes:
   - **New parts are added.** A custom part keeps its Onshape part number if no other part has it; otherwise it gets the next team number. Standard content (bolts, nuts) and parts with a vendor are COTS: Onshape's part number becomes the vendor's part number, and they get a team number too.
   - **Vendor part numbers are recognized** (#20). A new part with a vendor's number in its part number or name is COTS with that vendor: `WCP-0123` (West Coast Products), `am-1234` (Andy Mark), `REV-21-1650` (REV Robotics), `217-1234` and `276-1234` (VEX). `identifyCots()` in `data.ts` has the patterns: add a vendor there, with a test. Our own numbers (`4096-…`) are never taken for bought parts. It's a guess from how the number is written, so check the preview; a part already in the app keeps the kind it has, so fixing a wrong guess by hand sticks.
   - **Changed names, quantities, materials and revisions are updated.** Where Onshape has nothing (no material set yet, say), what's in the app stays.
   - **Parts no longer in Onshape are marked "Removed in Onshape"**, not deleted, so their history stays. If they come back, the mark goes.

Parts are matched by which Onshape part they are (`onshape_id`), never by name, so renaming a part in CAD keeps it. The first time, a part typed in by hand is matched if Onshape has the same part number. Parts imported from Onshape can have no material or vendor yet.

The example Intake in demo mode is linked to a made-up assembly, so **Import from Onshape** shows how it works without keys. The import columns are added by `supabase/migrations/20261028090000_bom_onshape_import.sql`.

## Files for the machines

Not on the page yet (#23). `data.ts` already works out which file each machine needs (`MACHINE_FILE_FORMATS`) and what it's called (`partFileName()`), and `partFiles()` lists a part's files from its stages:

| Machine | File |
|:--|:--|
| Lathe, mill | STEP |
| 3D printer | STL (or 3MF) |
| Laser | DXF |
| CNC router | DXF (or STEP) |
| Hand tools | none |

Files are named by part number and revision, like `4096-26-INT-014_revB.step`.

## Still to do

- View 3D and download buttons for a part's files, and a whole queue's (#23). They need a mentor: a viewer library, and file exports in the `onshape` server function
- A shared catalog of bought parts with names and links to buy them, filled in once and reused each season (#20)
- Write team part numbers into Onshape (#21)
- A "My work" list of the stages assigned to you
- Slack reminders about assigned stages (#22)
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
