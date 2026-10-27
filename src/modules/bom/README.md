# BOM

The bill of materials for each robot, checked against Inventory, so the team can see what to make and what to order.

**Built so far:** a robot is made of systems (Intake, Drivetrain, …), and each system has a list of parts. The page shows one system's parts with an All / Made / COTS filter, and anyone on the team can add parts with the **Add a part** button, whose form fills in the next free part number. The data starts as made-up example rows; importing from Onshape comes next (#19).

| File | What it does |
|:--|:--|
| `index.ts` | Tells the app about the module, and puts "2 systems · 12 parts" on the home page tile. |
| `data.ts` | The three tables (`bom_robots`, `bom_systems`, `bom_parts`), their example rows, and the filter and count functions. |
| `data.test.ts` | Tests for `data.ts`. |
| `BomPage.tsx` | Pick a system, then see its parts in a table. |

The tables are made by `supabase/migrations/20261027150000_bom.sql`, and their permission rules are tested in `supabase/tests/bom.test.ts`. Anyone on the team can add and change robots, systems and parts, and delete parts (`supabase/migrations/20261027170000_bom_members_edit.sql`). Only mentors can delete a system, because that deletes every part in it too.

**Part numbers.** Every part gets a team number like `4096-26-INT-001`: team, year, system code, then a number. Made parts also have a material, such as "6061 aluminum, 1/4 in plate". COTS (bought) parts have a vendor and the vendor's part number.

## Still to do

- The parts each system needs, from Onshape (#19)
- For bought parts: how many are on the shelf (from Inventory), and whether we're short
- For made parts: whether they have been made yet
- Mentors mark short parts as ordered
- Costs, visible only to mentors and admins

## Rules

- The Onshape keys can open all of the team's CAD. The real Onshape sync must run in a server function, never in the browser. Talk to a mentor before working on it, and use example data until then.
- Costs are hidden from students.
- Read stock levels through Inventory's `data.ts`, not by copying its data.

Copy the pattern from the [Example module](../example/README.md). Keep each pull request to one step.

**Works with:** Inventory (stock levels), Robot status (shows the short-line count).
