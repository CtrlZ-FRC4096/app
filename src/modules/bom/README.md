# BOM

The bill of materials for each robot, checked against Inventory, so the team can see what to make and what to order.

**Built so far:** a robot is made of systems (Intake, Drivetrain, …), and each system has a list of parts. The page shows one system's parts with an All / Custom / COTS filter. Student leaders, mentors and admins can add, change and delete parts, and import a system's parts from Onshape (see [Who can do what](#who-can-do-what)). Custom parts (made in our shop) show their stages (see below). COTS parts show their order from Purchasing, or a **Purchase** button that opens a request there, filled in from the part. COTS parts also show how many Inventory has on the shelf and where, and how many are missing or being ordered (see below).

| File | What it does |
|:--|:--|
| `index.ts` | Tells the app about the module, puts "Robot 62% built" on the home page tile (from `stats.ts`), and your stages to do under "Needs attention" (from `work.ts`). |
| `data.ts` | The four tables (`bom_robots`, `bom_systems`, `bom_parts`, `bom_steps`), their example rows, adding and changing them, moving stages along, assigning them, and reading a system from Onshape. |
| `onshape.ts` | Works out what an import from Onshape changes: `planOnshapeImport()`. |
| `stats.ts` | How close each system, and the whole robot, is to being built: `systemStats()`, `robotStats()`, and the home page tile's `useRobotSummary()` (see [Dashboard](#dashboard)). |
| `numbering.ts` | Team part numbers: `nextPartNumber()`, and the `bom_part_counters` table that remembers every number used (see [Part numbers](#part-numbers-21)). |
| `catalog.ts`, `Catalog.tsx` | The catalog of bought parts (`bom_catalog`): see [Catalog of bought parts](#catalog-of-bought-parts). |
| `data.test.ts`, `onshape.test.ts`, `stats.test.ts`, `numbering.test.ts`, `catalog.test.ts` | Tests for them. |
| `BomPage.tsx` | Pick a system, then see its parts in a table with their stages, change them, and import from Onshape. Below, the robot's To order list. |
| `Dashboard.tsx` | The page's **Dashboard** view: the robot's total, then a card for each system. |

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
| Give parts team numbers, and write part numbers to Onshape | | Yes |
| Delete a system (and every part in it) | | Yes |

The rules are in `supabase/migrations/20261110130000_bom_student_leaders.sql` (using `private.is_leader()`), and tested in `supabase/tests/bom.test.ts` and `bom-steps.test.ts`. In the app, `canEditRobotsAndParts()` in `data.ts` decides which buttons a student sees, and the functions in `data.ts` explain who to ask.

**A part's buttons.** Under each part's name and details is one row of buttons, always in this order (#172). A button that doesn't apply is left out, and on a phone the row wraps onto a second line.

| Button | Shows on | Does |
|:--|:--|:--|
| **Purchase**, or **Open in Purchasing** once there's a request | COTS parts | Opens a request in Purchasing filled in from the part, or the request it already has. Its status, **Late** and "Arrives Nov 12" sit just before it. |
| **Ready to CAM** | Custom parts | Puts the part on the CNC board. "2 on the CNC board" sits just before it. |
| **Product page ↗** | COTS parts with a product page, a catalog entry, or a Purchasing request with a link | Opens the product's page in a new tab: the part's own, else the catalog's, else the request's. |
| **Add to catalog** | COTS parts with a vendor part number that aren't in the catalog yet, for student leaders, mentors and admins | Opens a form to add it to the catalog, filled in from the part. |
| **Open CAD ↗** | Parts with an Onshape link | Opens the part in Onshape in a new tab. |
| **Edit** | Every part, for student leaders, mentors and admins | Opens the part's form, to change or delete it. Tapping the name does too. |

Parts marked "Removed in Onshape" don't show Purchase or Ready to CAM.

Every form (a part, Ready to CAM, stages, assigning a stage) opens near the top of the page, above the parts list, and scrolls itself into view when it opens (`InView` from `src/core/ui.tsx`, which Purchasing uses too), so it's never out of sight (#170).

**Custom and COTS.** Custom parts are made in our shop; COTS parts are bought. The page calls them Custom, but the database still stores them as `made`, so no migration was needed for the name.

**Changing a Custom part to COTS** (#169). Some parts come in from Onshape as Custom, but we buy them, like belts drawn with a belt generator. **Edit** the part and pick COTS, then fill in the vendor, vendor part number and **Product page** (an optional `https://` link). Its material is cleared.
- **Its stages are removed** when you save, so it drops out of the station queues. The form says so first: "This part has 3 stages (1 done). Changing it to COTS removes them." (`kindChangeWarning()` and `changePart()` in `data.ts`).
- **The CNC board is left alone.** If some are on the CNC board, the form says so: take them off there if they won't be cut.
- It then shows like any other COTS part: what's on the shelf, its order in Purchasing (or **Purchase**), and it counts in **To order**. **Purchase** fills in Purchasing's link from the product page.
- **Changing it back to Custom** works too. It starts with no stages: choose them with **Add stages**.

The product page column is added by `supabase/migrations/20261113120000_bom_parts_product_url.sql`, with its rules tested in `supabase/tests/bom.test.ts`.

**Part numbers.** Every part gets a team number like `4096-26-INT-001`: team, year, system code, then a number. Custom parts also have a material, such as "6061 aluminum, 1/4 in plate". COTS (bought) parts have a vendor and the vendor's part number.

## Catalog of bought parts

A list of the parts we buy, with each one's name and a link to buy it (#20). The team fills it in once and reuses it every season, so nobody looks up the same motor twice.

- **A COTS part that's in the catalog** shows "Catalog: …" with the catalog's name under its vendor details, and its **Product page ↗** button opens the catalog's link (unless the part has its own product page).
- **A COTS part that isn't in the catalog yet** shows **Add to catalog** to student leaders, mentors and admins. The form is filled in from the part: check the name, paste the link to buy it, and save. The vendor is named the way Purchasing names it ("WCP" becomes "West Coast Products").
- **Catalog of bought parts**, at the bottom of the page, lists every entry with a **Buy ↗** link. Tap **Show** to open it. Student leaders and mentors tap an entry's name to change or delete it, or **Add an entry** by hand.

**How a part finds its entry:** `catalogEntryFor()` in `catalog.ts` looks for the same **vendor part number** (ignoring capitals and spaces, like `shelfItem()`) from the **same vendor**. Vendors are compared the way Purchasing names them (`vendorFor()`), so "REV" and "REV Robotics" are one vendor, and so are "AndyMark" and "Andy Mark". Both have to match, so another vendor's part with the same number never shows the wrong link to buy. A part with no vendor yet matches on the number alone, if only one entry has it. A COTS part with no vendor part number can't be matched: **Edit** it to add one.

Every entry needs a vendor, a vendor part number, a name and a link to buy it (`https://` only), and there's one entry per vendor and vendor part number. **Prices aren't in the catalog**: everyone on the team can read it, so prices go in a mentor-only table later.

| | Students | Student leaders, mentors and admins |
|:--|:--|:--|
| See the catalog | Yes | Yes |
| Add, change and delete entries | | Yes |

The table is made by `supabase/migrations/20261114100000_bom_catalog.sql`, with its rules tested in `supabase/tests/bom-catalog.test.ts`. `data.ts` passes on everything in `catalog.ts` (`export * from './catalog'`), so other modules read the catalog from `data.ts`.

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

## My work

What's assigned to you, and giving a whole part to someone at once (#16).

- **My work** is a panel at the top of the BOM page with the stages assigned to you, grouped **To do**, **In progress** and **Done**. Done is folded away. In each group, **Late** stages come first, then the soonest due. Each line shows the stage, the part's number, name and system, and when it's due. **Show part** picks the part's system (showing every part) and scrolls to it, where you move the stage along as usual. The panel only shows when you have a stage that isn't done. Stages of parts marked "Removed in Onshape" aren't listed, because the page doesn't show their stages.
- **Assign every stage at once.** In a stage's **Assign** form, tick **Assign every stage that isn't done** to give all of the part's unfinished stages the same person and due date. Done stages keep who did them. It shows when the part has more than one stage left.
- **The home page** shows your open stages under "Needs attention", like "3 stages to do (1 late)", in the warning colour when any are late. "To do" there means every stage that isn't done, started or not. Nothing shows when you have none.

| File | What it does |
|:--|:--|
| `work.ts` | `myWork()` (your stages, grouped), `workNotices()` (the home page line, set as `useAttention` in `index.ts`), and `assignWholePart()`, which uses `assignStep()` from `data.ts` for each stage. |
| `work.test.ts` | Tests for it. |
| `MyWork.tsx` | The My work panel, mounted near the top of `BomPage.tsx`. |

Anyone on the team can assign stages and move any stage along, as with one stage at a time: no database change was needed.

## On the shelf

Under each COTS part, the page shows what Inventory has, in plain text: "On the shelf: 4 · Bin M1", or "Not in Inventory". Then either:

- the quantity on the part's request in Purchasing, with how far along it is (`orderWord()`): **"Ordering 3"** while it's still being asked for (Wait to Order and the Order statuses), **"Ordered 3"** once it's placed (Order Placed, Backordered), and **"Received 3"** once it's Received or In Shop; or
- **"Missing 2"** when there's no request, or it was cancelled or is Out of Stock (so it couldn't be ordered), and the shelf has fewer than the line needs. Nothing is added when there are enough.

 `shelfItem()` in `data.ts` finds the Inventory part with the same **vendor part number**, ignoring capitals and spaces. Vendor names only decide when two Inventory parts have the same number, because the team writes them differently ("REV" and "REV Robotics"). **A part used in more than one system is added up** (#17): `shortages()` in `data.ts` gives, for each COTS part in a robot, how many are needed across all its systems, how many are on the shelf, and how many short. So if the intake needs 6 of a bearing and the drivetrain 4, with 7 on the shelf, both lines say "Robot needs 10 in 2 systems · Missing 3". A part that isn't in Inventory is fully short.

## To order

At the bottom of the page, **To order** lists the COTS parts the whole robot is short of, grouped by vendor (#17). Each line shows how many the robot needs, how many are on the shelf, how many are already in Purchasing, and how many are left to order. **Copy as CSV** copies the list (vendor, vendor part number, part, quantity to order) to paste into a spreadsheet or an order.

`toOrder()` in `data.ts` builds it from `shortages()`. To stop a part being ordered twice, it takes off what's already on a request in Purchasing for those BOM lines. Requests that are cancelled or Out of Stock don't count. Requests that are In Shop don't count either: they're put away, so Inventory's count should include them. **If something is In Shop but Inventory wasn't updated, it shows here again**, so update Inventory when parts are put away. Vendors are named the way Purchasing names them (`vendorFor()`), so "REV" and "REV Robotics" are one group.

## Dashboard

At the top of the page, **View: Parts / Dashboard** switches between one system's parts and the dashboard (#23). The dashboard shows how far along the whole robot is, then a card for each system with a progress bar and how many parts are waiting at each stage, like "3 waiting for CNC router". Tap one of those to see the parts: it opens that system's parts with the station filter set. The home page's BOM tile says the same in a few words: "Robot 62% built". With more than one robot, it names the one the page opens on.

It updates straight away when anyone moves a stage along or Inventory changes, because it reads the same rows as the rest of the page.

The numbers come from `stats.ts`. What counts as done:

- **A stage** is finished when it's marked **Done**. A Done stage counts all of the part's quantity as through it, even if nobody counted them with +.
- **A piece of a Custom part is made** when it's through every one of the part's stages. A part with 4 through the lathe but 1 through post-process has 1 of 4 made.
- **A Custom part is done** when it has at least one stage and every stage is Done. A Custom part with no stages yet isn't done (nobody's said how it's made), and the card says how many there are.
- **A COTS part is on the shelf** when Inventory has enough for the whole robot. A part used in more than one system is added up first, the same way **To order** does (`shortages()`), so 7 bearings aren't counted as enough for the intake's 6 and again for the drivetrain's 4. If the robot has 7 of the 10, each system's line counts as 70% there. Only Inventory counts: a part that's arrived but isn't in Inventory yet doesn't.
- **The percent** counts quantities: 3 of 4 made counts as 75% of that part, and 6 of 8 wheels on the shelf as 75%. **Each part counts the same**, so 120 rivets don't count for more than the whole intake. The robot's total counts every part in the robot, so a system with more parts counts for more. It's rounded down, so it only says 100% when everything is done.
- **Waiting** counts parts (lines), not pieces, the same as the station filter: a part is waiting for a stage while that stage isn't Done. The process stages are counted by their machine.
- **Parts removed in Onshape** don't count anywhere.

If every piece has been counted through a stage but it isn't marked Done, the part counts as made in the percent but still shows as waiting. Mark the stage Done when the last one's through.

## Importing from Onshape

Student leaders, mentors and admins import. Students can add a system's Onshape link, then ask one of them.

1. **Link the system.** Open the system's assembly (or Part Studio) in Onshape, copy the address, and paste it into **Change system > Onshape link**.
2. **Import from Onshape** reads its parts through the `onshape` server function (`supabase/functions/onshape/`), which holds the team's Onshape keys. Sub-assemblies are flattened into one list.
3. The page shows what will change before anything is saved. **Import** makes the changes:
   - **New parts are added.** A custom part keeps its Onshape part number if no other part has it; otherwise it gets the next team number. Standard content (bolts, nuts) and parts with a vendor are COTS: Onshape's part number becomes the vendor's part number, and they get a team number too.
   - **Vendor part numbers are recognized** (#20). A new part with a vendor's number in its part number or name is COTS with that vendor: `WCP-0123` (West Coast Products), `am-1234` (Andy Mark), `REV-21-1650` (REV Robotics), `217-1234` and `276-1234` (VEX). `identifyCots()` in `data.ts` has the patterns: add a vendor there, with a test. Our own numbers (`4096-…`) are never taken for bought parts. It's a guess from how the number is written, so check the preview; a part already in the app keeps the kind it has, so fixing a wrong guess by hand sticks.
   - **A part that's already COTS keeps what we typed:** its vendor, vendor part number and product page. Onshape only fills them in where they're empty. So a belt changed to COTS by hand stays COTS with its details.
   - **Changed names, quantities, materials and revisions are updated.** Where Onshape has nothing (no material set yet, say), what's in the app stays.
   - **Parts no longer in Onshape are marked "Removed in Onshape"**, not deleted, so their history stays. If they come back, the mark goes.

Parts are matched by which Onshape part they are (`onshape_id`), never by name, so renaming a part in CAD keeps it. The first time, a part typed in by hand is matched if Onshape has the same part number. Parts imported from Onshape can have no material or vendor yet.

The example Intake in demo mode is linked to a made-up assembly, so **Import from Onshape** shows how it works without keys. The import columns are added by `supabase/migrations/20261028090000_bom_onshape_import.sql`.

## Part numbers (#21)

Every part has a team number in the format `4096-<year>-<system code>-<number>`, like `4096-26-INT-014`. The first three pieces, `4096-26-INT`, are the part's **series**.

- **A number is never given out twice.** `nextPartNumber()` in `numbering.ts` gives one more than the highest number the series has *ever* used, not just the highest there is now. So if `4096-26-INT-006` is deleted, the next new part is `-007`, not `-006` again, and an old printed drawing never points at the wrong part. Gaps are skipped, not filled.
  - The database remembers the highest number in `bom_part_counters`, one row per series. A trigger raises it whenever a part with a team number is added or renumbered, and never lowers it. Nobody can change it from the app, students or mentors. In demo mode, `rememberNumbers()` does what the trigger does.
  - It's one row per series, not per system, because part numbers are unique across the whole BOM: a system deleted and added again, or a practice robot that also has an INT system, carries on from the same number.
  - Typing a number by hand still works, even an old one (to put back a part deleted by mistake). A typo like `-900` moves the series on to `-901`.
  - Made by `supabase/migrations/20261114110000_bom_part_counters.sql`, with its rules tested in `supabase/tests/bom.test.ts`. Numbers used by parts deleted before that migration can't be remembered.
- **Give team numbers** shows on a system when some of its custom parts have no team number: usually one kept from Onshape, like `BRKT-1`. It gives each the next number. COTS parts are left alone: every one added or imported already gets a team number, and they're known by their vendor's number.
- **Write part numbers to Onshape** puts each custom part's team number into its **Part number** property in Onshape, through the `onshape` server function (its `part-numbers` request, in `supabase/functions/onshape/numbers.ts`). The next import reads them back, so the part on the bench, its drawing, the BOM and CAD all have the same name.
  - **Only in a workspace.** The system's Onshape link needs `/w/` in it. Onshape doesn't let a version change, so a version link is refused, with what to do instead.
  - **Only custom parts in the system's own Onshape document.** Parts linked in from another document, parts with configurations, COTS parts (CAD keeps the vendor's number) and parts removed in Onshape aren't written. The message after says which were skipped and why.
  - **Cost:** one Onshape API call for each Part Studio, plus one for each part whose number is different. Parts that already match aren't written, so doing it again is cheap.
  - The server function checks the caller is a student leader, mentor or admin, and the Onshape keys never leave the server. The keys need **Write to your documents** (see `supabase/README.md`). In demo mode it pretends every number was written.

### When CAD and the app disagree

- **For team part numbers, the app wins.** The app hands the numbers out and remembers every one ever used, across all the team's Onshape documents, so it's the one list. When importing, a part that already has a team number keeps it, whatever Onshape's Part number says. To change a number, **Edit** the part here, then **Write part numbers to Onshape**. Until a custom part has a team number, Onshape's number is used (if no other part has it), so a number typed into CAD first still comes in.
- **For everything else Onshape has, CAD wins:** names, quantities, materials and revisions are updated on each import, where Onshape has them. A COTS part's vendor details and product page stay what was typed here (#169).
- We don't number parts inside CAD with a FeatureScript (FRCBOM's, or Onshape's community "Automated Part Numbering"): each document would keep its own list of numbers, which could clash with the app's.

## Files for the machines

Whoever is at a machine can download the part's file without opening Onshape (#24). Under a custom part's stages, **Files:** has a **Download STEP** or **Download STL** button for each file its machines need. Pick a machine in the station filter (say "Lathe only") and **Download all 3 STEP files** at the top gets every part in that queue, one after another (the browser may ask once whether the site can download several files: choose Allow). There's no zip, so no extra package was needed.

| Machine | File it needs | What the app downloads now |
|:--|:--|:--|
| Lathe, mill | STEP | STEP |
| 3D printer | STL (or 3MF) | STL, in millimeters |
| CNC router | DXF (or STEP) | STEP, until DXF works |
| Laser | DXF | Nothing yet: export it from Onshape (**Open CAD**) |
| Hand tools | none | |

Files are named by part number and revision, like `4096-26-INT-014_revB.step`.

- **Anyone on the team can download.** It changes nothing, and the people at the machines need the files. The server function only fetches parts that are in the BOM: the app sends the part's id, and the function reads its Onshape link from `bom_parts` with the caller's own sign-in.
- **Only parts imported from Onshape** can be downloaded, because the app has to know which Onshape part each one is (`onshape_id`). Parts typed in by hand say so.
- **Onshape is only asked when someone presses Download.** An STL is one Onshape API call. A STEP is made by Onshape in the background (a "translation"): one call to start it, a few to check it's done, and one to fetch it, so about 4 to 6. A whole queue is that for each part. Files bigger than 20 MB aren't passed on.
- **In demo mode** the buttons give a tiny made-up file (a 20 mm cube STL, or a STEP with only a header), so they can be tried without keys.

| File | What it does |
|:--|:--|
| `data.ts` | Which file each machine needs (`MACHINE_FILE_FORMATS`), its name (`partFileName()`), and a part's files from its stages (`partFiles()`). |
| `files.ts` | Which of those the app can download (`partDownloads()`), a machine's queue (`queueFiles()`), and downloading through the `onshape` server function (`downloadPartFile()`, `downloadQueue()`). Tested in `files.test.ts`. |
| `Downloads.tsx` | The **Files:** buttons under a part, and the queue's download button. |
| `supabase/functions/onshape/files.ts` | What the server function asks Onshape for a part's STEP or STL, and checks on what comes back. Tested with a made-up Onshape in `supabase/tests/onshape-files.test.ts`. |

**View 3D** isn't built yet: it needs a 3D viewer library, which is an npm package, so a mentor decides (see the pull request for #24).

## Slack reminders

Messages from the team's Slack bot about the stages assigned to people (#22). They use the team's scheduled reminders (`src/core/reminders.ts`), switched on in `src/modules/reminders.ts`, and are sent by the "Send Slack reminders" workflow at about 3 PM Chicago time. No Slack token is in the app: the workflow and the `slack` server function hold it.

| File | What it does |
|:--|:--|
| `reminders.ts` | The two scheduled reminders, the text of every message, and **Remind now**. The choices the team should confirm are constants at the top. |
| `reminders.test.ts` | Tests for them. |
| `ReminderControls.tsx` | The **Daily Slack reminder about my stages** switch at the bottom of the page, and **Remind now** on a stage. |

- **Daily, Monday to Friday** (`DAILY_DAYS`): each person with stages assigned to them that aren't done gets one direct message listing them (part number, name and stage), late ones first, with a link to the BOM. Only custom parts' stages, not parts removed in Onshape. At most 15 are listed, then "…and 4 more".
- **Weekly, on Mondays** (`WEEKLY_DAYS`), for mentors and admins: what's late (and who has it), and what isn't given to anyone yet. It goes to each of them directly. If the team makes a mentors' channel, put its ID in `MENTOR_CHANNEL` and invite the app to it: then it goes there instead.
- **Remind now** (mentors and admins): after a stage's assignee, sends them a reminder about that one stage straight away, saying which mentor asked. It goes through the `slack` server function, which checks it's a mentor too.
- **Turning it off.** Anyone can turn their own daily reminder off and on with the switch at the bottom of the BOM page. Remind now still reaches them: a mentor asked. The setting is a row in `bom_reminder_opt_outs` (a row means "off"), made by `supabase/migrations/20261114120000_bom_reminder_opt_outs.sql`: each person sees, adds and removes only their own. Its rules are tested in `supabase/tests/bom-reminder-opt-outs.test.ts`. The scheduled reminders read every row because they read the database as its owner.

## Still to do

- View 3D, and DXF downloads for the laser and router (#24). 3D needs a mentor to pick a viewer library
- Try **Write part numbers to Onshape** on the team's real CAD, once a mentor has checked the Onshape keys can write (#21). It's only been tested against a made-up Onshape
- Slack reminders (#22): the team to confirm the days and who gets the weekly summary (see [Slack reminders](#slack-reminders))
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
