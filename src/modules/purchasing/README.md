# Purchasing

What the team needs to buy, from asking for it to it being in the shop. It replaces the **BOM List** in Slack's build parts channel ([#66](https://github.com/CtrlZ-FRC4096/app/issues/66)).

This list is typed in by hand. It's **separate from the BOM**, which comes from Onshape: anything the team needs to order goes here, whether or not it's in a robot's CAD.

## Built so far

- **The Slack list's columns:** name, status, vendor, type, link, part/item number, number needed, price, requested by and notes.
- **Its 10 statuses, in order:** Wait to Order, Order Low Priority, Order, Order High Priority, Order Placed, Out of Stock, Backordered, Received, In Shop, Cancel Item.
- **Its views:** **Current** (what's in progress, newest first under "In progress", with each item's status shown; it includes Backordered), **All**, **By status** and **By vendor**.
- **Search** (#75): narrows every view to items whose name, vendor, type, part number or notes contain every word typed.
- **Adding a new item:** the **Add new item** button at the top, next to Search. You pick its priority (Wait to Order, or one of the three "Order" statuses).
- **Duplicate** (#76) on an item opens **Add new item** filled in from it, to buy it again.
- **Changing an item:** tap it to open it. Delete takes two presses.
- **Who can do what** (#78): anyone on the team asks for things, and changes anything about a request, including its priority. Once an item is ordered (Order Placed or after), only mentors and purchasers change anything about it: everyone else sees it as text, with Close instead of Save. Only mentors, admins and **purchasers** place an order (Order Placed) or move it on (Out of Stock, Backordered, Received, In Shop, Cancel Item), fill in the order details, and delete an order. Students can still delete a request. Mentors and admins choose the purchasers with the **Purchaser** tick on the Members page (#144), using `setBuyer()`, `canChooseBuyers()` and `canBeBuyer()` from `data.ts`. The bottom of this page lists who they are, so everyone knows who to ask.
- **Order details**, at the bottom of an item's form: **Ordered by** (filled in with whoever moves an item to Order Placed, as soon as they pick it in the form (`pickStatus()`), and by the database when it's saved, unless they pick someone else), **Shipped to**, and **Estimated arrival**, set by whoever places the order. The form only shows them once the status is Order Placed or later (`orderFieldsShown()`), unless one is already filled in. Only mentors and purchasers fill these in; everyone else sees them as text.
- **Arrives and Late:** an order on its way shows "Arrives Nov 12", and a **Late** tag once that date has passed and it still isn't received. The BOM shows the same.
- **From the BOM** (#80): a COTS part's **Purchase** button opens **Add new item** filled in from the part (name, vendor, product page link, vendor part number, quantity, and its system as the type), linked to the part. The BOM then shows the request's status, with a link to it here. The BOM's vendor names are matched to the list in `vendorFor()`.
- **From Inventory** (#194): a part's **Order more** button opens **Add new item** filled in from it (`requestFromInventoryItem()`): name, product link, vendor part number, and 1 needed. Its vendor is matched to the list with `vendorFor()`, so "AndyMark" becomes Andy Mark; a vendor that isn't on the list is left to pick, with Inventory's name for it in the notes. The page reads the part through Inventory's `data.ts`. If the part isn't found, Purchasing opens as normal.
- **Prices:** Price each is what one costs, and it can be left empty. The list and the form work out the line's total from it and Number needed, like "$12.50 each · $50.00 total" (`priceText()`), so the two can't disagree. Everyone on the team sees prices. Anyone can fill one in or change it while an item is being asked for; once it's ordered, only mentors and purchasers can change it, like everything else about an order. Shipping, tax and a total for a whole order aren't built yet.
- **Requested by** is always whoever filled in the form (everyone signs in with Slack). Nobody can pick someone else or change it later, not even a mentor. Importing the Slack list (step 3) will need a mentors-only way to keep its names.
- **Notifications** (#93): when a request is ordered (Order Placed) or arrives (Received), whoever asked for it gets a notification in the bell, which opens the item. Nobody gets one for their own change. The database adds them (`supabase/migrations/..._purchase_notifications.sql`, tested in `supabase/tests/purchase-notifications.test.ts`), so demo mode doesn't show them. They don't go to phones yet.
- **Receipts** (#79): once an item is ordered (#168), mentors and purchasers can open it to add a PDF or photo of its receipt, or several. **Add receipt** appears as soon as they pick Order Placed or a later status in the form, along with the other order fields. Existing receipts stay visible if the status goes back to asking; they can still be opened and deleted. On a phone, **Add receipt** offers the camera as well as files. Up to 10 MB each. See [Receipts](#receipts).
- The home page tile shows "3 to order now (1 high priority)".

The statuses, vendors and types are lists at the top of `data.ts`, so they're easy to change. Vendors and types can change freely. A new status also needs a migration, because the database checks them.

| File | What it does |
|:--|:--|
| `index.ts` | Tells the app about the module: it's in the Build menu, with the home page tile's status. |
| `data.ts` | The lists, the `purchase_items` table and its example rows, the views, the checks, adding, changing and deleting items, and receipts. |
| `data.test.ts` | Tests for `data.ts`. |
| `PurchasingPage.tsx` | The view switch and search, the items under each heading, the form, receipts, and the purchasers. Its address can open a request from a BOM part (`#/purchasing/from-bom/<part id>`) or an Inventory part (`#/purchasing/from-inventory/<part id>`), or an item (`#/purchasing/item/<item id>`). |

The tables are made by `supabase/migrations/20261102180000_purchase_items.sql`, `..._purchasing_orders.sql` (purchasers, Ordered by, Shipped to and who changes orders), `..._purchase_items_bom_part.sql` (the link to a BOM part), `..._purchase_items_estimated_arrival.sql` and `..._purchase_items_price.sql`. Their permission rules are tested in `supabase/tests/purchase-items.test.ts` and `purchasing-orders.test.ts`. Receipts have their own migration and tests: see [Receipts](#receipts).

## Receipts

Receipts can show card digits, addresses and names, so:

| Who | See that an item has one | Add | Open | Delete |
|:--|:--|:--|:--|:--|
| Anyone on the team | Yes | | | |
| Purchasers | Yes | Yes | Yes | Yes |
| Mentors and admins | Yes | Yes | Yes | Yes |

- The files are in the **private** `purchase-receipts` storage bucket, made by `supabase/migrations/20261106120000_purchase_receipts.sql` with its rules, and `20261107120000_purchasers_manage_receipts.sql` lets purchasers open and delete. Those rules are tested in `supabase/tests/purchase-receipts.test.ts`.
- **Opening** one makes a signed link that stops working after 60 seconds. Anyone who has that link can use it until then, so don't paste it anywhere.
- **Only exact file types** are allowed (PDF, JPEG, PNG, WebP, HEIC), never all of `image/*`: SVG images can run code when they're opened.
- `purchase_receipts` has a row for each file, which is how students can see an item has a receipt. It never holds the file's own name, which can have personal details in it.
- **An item with a receipt can't be deleted** until a mentor or purchaser deletes the receipt. It's a record of what was spent. Cancel the item instead.
- Demo mode has no file storage: adding a receipt saves only the row, and Open says so.

## Still to do (#66)

2. **Ordering details:** date ordered, tracking number; **Copy as CSV** for one vendor's items; totals for a whole order, with shipping and tax. (Ordered by, Shipped to, Estimated arrival and prices are done.)
3. **Import from Slack:** a mentors-only import of the BOM List's JSON export. Don't commit the real export.
4. **Receipts from the Slack list:** the export only has Slack file ids, so old receipts can't come across automatically. Decide whether to download them by hand or leave them in Slack (#79). The Slack list's other files aren't built yet.
5. **The BOM:** asking for the parts #17 finds short, taking away what's already on the shelf. (The Purchase button and status are done.)
6. **The home page:** "Needs attention" for High Priority items and items past their estimated arrival.

## Rules

- Prices are a column here because a mentor decided the whole team can see them: they're public on vendors' sites. If that ever changes, they'd need their own table that only mentors can read, because the database's rules work on whole rows.
- Example data is made up. Never commit the real Slack export: it has Slack user IDs, prices and receipts, and this repo is public.

Copy the pattern from the [Example module](../example/README.md). Keep each pull request to one step.
