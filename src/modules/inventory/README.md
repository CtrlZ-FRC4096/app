# Inventory

Parts, where they live, and how many are left, with a record of who took or added stock.

**So far:** the `inventory_items` table with example parts, a page that lists them, and a low-stock flag and filter that also show on the home page. Anyone can add a part; mentors and admins have an **Edit** button on each part to change its quantity and location, or delete it.

**Taking and adding stock:** everyone has a **Take / add** button on each part. `changeStock()` in `data.ts` changes the quantity and adds a line to the part's history (the `inventory_changes` table): who, how many, when, and an optional note. It refuses to take more than are on the shelf. A mentor's Edit that changes the count adds a "Count corrected" line, so the history always adds up. Nobody can edit or delete history lines.

## What it needs to do

- A list of parts with location, quantity and a low-stock level
- Take and add stock, recording who did it and when
- A low-stock flag, and a filter to show only low parts
- Search by name, bin or vendor
- A QR label for each bin that opens that part in the app
- Copy the list as CSV, so the data can always leave the app

## Rules

- Anyone signed in can add parts, and take or add stock. Only mentors and admins change a part's name, location or low-stock level, or delete it. The database enforces this with a trigger in `supabase/migrations/..._inventory_changes.sql`, since a column grant would stop mentors too.
- Taking stock changes the quantity, then adds the history line, as two steps. If two people take the same part at the same moment, one can overwrite the other. A database function that does both at once would fix that; ask a mentor.
- Other modules will read stock levels from this module's `data.ts` (the BOM needs them), so keep its functions simple and tested.

## Where to start

1. ~~Create `data.ts` with an `Item` type and example parts.~~ Done.
2. ~~Show the parts in a table on the page.~~ Done.
3. ~~Add `changeStock()` with tests: it should refuse to take more than are on the shelf.~~ Done.
4. ~~Add the low-stock flag and filter.~~ Done.

Copy the pattern from the [Example module](../example/README.md): a table
and rules in `data.ts`, tests in `data.test.ts`, and the page calling
`data.ts`. Each table also needs a migration in `supabase/migrations/` that
makes it in the team database, with its permission rules and tests; see
[Adding a module](../../../docs/adding-a-module.md). Keep each pull request to
one step.

**Works with:** BOM (reads stock levels), Robot status (shows the low-stock count).
