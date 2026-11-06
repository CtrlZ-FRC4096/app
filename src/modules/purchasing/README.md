# Purchasing

What the team needs to buy, from asking for it to it being in the shop. It replaces the **BOM List** in Slack's build parts channel ([#66](https://github.com/CtrlZ-FRC4096/app/issues/66)).

This list is typed in by hand. It's **separate from the BOM**, which comes from Onshape: anything the team needs to order goes here, whether or not it's in a robot's CAD.

## Built so far

- **The Slack list's columns:** name, status, vendor, type, link, part/item number, number needed, requested by and notes.
- **Its 10 statuses, in order:** Wait to Order, Order Low Priority, Order, Order High Priority, Order Placed, Out of Stock, Backordered, Received, In Shop, Cancel Item.
- **Its views:** **Current** (what's in progress, by status: the one people work from, and it includes Backordered), **All**, **By status** and **By vendor**.
- **Search** (#75): narrows every view to items whose name, vendor, type, part number or notes contain every word typed.
- **Asking for something:** the button at the top, next to Search. You pick its priority (Wait to Order, or one of the three "Order" statuses).
- **Duplicate** (#76) on an item opens Ask for something filled in from it, to buy it again.
- **Changing an item:** tap it to open it. Delete takes two presses.
- **Who can do what** (#78): anyone on the team asks for things, and changes anything about a request, including its priority. Only mentors, admins and **purchasers** place an order (Order Placed) or move it on (Out of Stock, Backordered, Received, In Shop, Cancel Item), fill in the order details, and delete an order. Students can still delete a request. Mentors add and remove purchasers at the bottom of the page.
- **Order details**, at the bottom of an item's form: **Ordered by** (filled in with whoever moves an item to Order Placed, as soon as they pick it in the form (`pickStatus()`), and by the database when it's saved, unless they pick someone else), **Shipped to**, and **Estimated arrival**, set by whoever places the order. The form only shows them once the status is Order Placed or later (`orderFieldsShown()`), unless one is already filled in. Only mentors and purchasers fill these in; everyone else sees them as text.
- **Arrives and Late:** an order on its way shows "Arrives Nov 12", and a **Late** tag once that date has passed and it still isn't received. The BOM shows the same.
- **From the BOM** (#80): a COTS part's **Purchase** button opens Ask for something filled in from the part (name, vendor, vendor part number, quantity, and its system as the type), linked to the part. The BOM then shows the request's status, with a link to it here. The BOM's vendor names are matched to the list in `vendorFor()`.
- **Requested by** is always whoever filled in the form (everyone signs in with Slack). Nobody can pick someone else or change it later, not even a mentor. Importing the Slack list (step 3) will need a mentors-only way to keep its names.
- The home page tile shows "3 to order now (1 high priority)".

The statuses, vendors and types are lists at the top of `data.ts`, so they're easy to change. Vendors and types can change freely. A new status also needs a migration, because the database checks them.

| File | What it does |
|:--|:--|
| `index.ts` | Tells the app about the module: it's in the Build menu, with the home page tile's status. |
| `data.ts` | The lists, the `purchase_items` table and its example rows, the views, the checks, and adding, changing and deleting items. |
| `data.test.ts` | Tests for `data.ts`. |
| `PurchasingPage.tsx` | The view switch and search, the items under each heading, the form, and the purchasers. Its address can open a request from a BOM part (`#/purchasing/from-bom/<part id>`) or an item (`#/purchasing/item/<item id>`). |

The tables are made by `supabase/migrations/20261102180000_purchase_items.sql`, `..._purchasing_orders.sql` (purchasers, Ordered by, Shipped to and who changes orders), `..._purchase_items_bom_part.sql` (the link to a BOM part) and `..._purchase_items_estimated_arrival.sql`. Their permission rules are tested in `supabase/tests/purchase-items.test.ts` and `purchasing-orders.test.ts`.

## Still to do (#66)

2. **Ordering details:** date ordered, tracking number; **Copy as CSV** for one vendor's items; prices and totals. (Ordered by, Shipped to and Estimated arrival are done.)
3. **Import from Slack:** a mentors-only import of the BOM List's JSON export. Don't commit the real export.
4. **Receipts and files** (#79), once a mentor sets up file storage.
5. **The BOM:** asking for the parts #17 finds short, taking away what's already on the shelf. (The Purchase button and status are done.)
6. **The home page:** "Needs attention" for High Priority items and items past their estimated arrival.

## Rules

- If prices are mentors-only, they go in their own table that only mentors can read, not a column here: the database's rules work on whole rows.
- Example data is made up. Never commit the real Slack export: it has Slack user IDs, prices and receipts, and this repo is public.

Copy the pattern from the [Example module](../example/README.md). Keep each pull request to one step.
