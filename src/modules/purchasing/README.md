# Purchasing

What the team needs to buy, from asking for it to it being in the shop. It replaces the **BOM List** in Slack's build parts channel ([#66](https://github.com/CtrlZ-FRC4096/app/issues/66)).

This list is typed in by hand. It's **separate from the BOM**, which comes from Onshape: anything the team needs to order goes here, whether or not it's in a robot's CAD.

## Built so far (step 1 of #66: the list)

- **The Slack list's columns:** name, status, vendor, type, link, part/item number, number needed, requested by and notes.
- **Its 10 statuses, in order:** Wait to Order, Order Low Priority, Order, Order High Priority, Order Placed, Out of Stock, Backordered, Received, In Shop, Cancel Item.
- **Its views:** **Current** (what's in progress, by status: the one people work from, and it includes Backordered), **All**, **By status** and **By vendor**.
- **Asking for something:** the form at the top. You pick its priority (one of the four "Order" statuses).
- **Changing an item:** tap it to open it, then change its status or anything else. Delete takes two presses.
- **Who can do what:** like the Slack list, anyone on the team can add, change and delete any item.
- The home page tile shows "3 to order now (1 high priority)".

The statuses, vendors and types are lists at the top of `data.ts`, so they're easy to change. Vendors and types can change freely. A new status also needs a migration, because the database checks them.

| File | What it does |
|:--|:--|
| `index.ts` | Tells the app about the module: it's in the Build menu, with the home page tile's status. |
| `data.ts` | The lists, the `purchase_items` table and its example rows, the views, the checks, and adding, changing and deleting items. |
| `data.test.ts` | Tests for `data.ts`. |
| `PurchasingPage.tsx` | The view switch, the form, and the items under each heading. |

The table is made by `supabase/migrations/20261102180000_purchase_items.sql`, and its permission rules are tested in `supabase/tests/purchase-items.test.ts`.

## Still to do (#66)

2. **Ordering details:** date ordered, estimated arrival, tracking number, ordered by, shipped to; **Copy as CSV** for one vendor's items; prices and totals.
3. **Import from Slack:** a mentors-only import of the BOM List's JSON export. Don't commit the real export.
4. **Receipts and files**, once a mentor sets up file storage.
5. **Join it to the BOM:** requests from #17's shortages, and each BOM COTS line's purchase status.
6. **The home page:** "Needs attention" for High Priority items and items past their estimated arrival.

## Rules

- If prices are mentors-only, they go in their own table that only mentors can read, not a column here: the database's rules work on whole rows.
- Example data is made up. Never commit the real Slack export: it has Slack user IDs, prices and receipts, and this repo is public.

Copy the pattern from the [Example module](../example/README.md). Keep each pull request to one step.
