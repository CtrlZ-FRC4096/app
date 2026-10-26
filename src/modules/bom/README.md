# BOM

**Not built yet.** The bill of materials for each Onshape assembly, checked against Inventory, so the team can see what to make and what to order.

## What it needs to do

- The parts each assembly needs, from Onshape
- For bought parts: how many are on the shelf (from Inventory), and whether we're short
- For made parts: whether they have been made yet
- Mentors mark short parts as ordered
- Costs, visible only to mentors and admins

## Rules

- The Onshape keys can open all of the team's CAD. The real Onshape sync must run in a server function, never in the browser. Talk to a mentor before working on it, and use example data until then.
- Costs are hidden from students.
- Read stock levels through Inventory's `data.ts`, not by copying its data.

## Where to start

1. Create `data.ts` with an example assembly: a few made parts and a few bought parts.
2. Show the lines in a table with a status for each.
3. Once Inventory has `data.ts`, look up shelf counts from it, with a test that taking parts in Inventory makes a BOM line short.

Copy the pattern from the [Example module](../example/README.md): data and
rules in `data.ts`, tests in `data.test.ts`, the page calling `data.ts`.
Keep each pull request to one step.

**Works with:** Inventory (stock levels), Robot status (shows the short-line count).
