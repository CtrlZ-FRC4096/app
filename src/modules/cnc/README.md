# CNC

What needs cutting on the router, the stock it's cut from, and every sheet on the rack with what's been cut from it: a digital twin of each sheet, so the next person knows where there's room. Issues #54 (the board), #55 (Onshape checks and time to route) and #56 (sheet tracking).

**Built so far:**

- **Board.** Made parts from the BOM, grouped by the stock they're cut from, each going Ready to CAM → To cut → Cutting → Cut, then a "Cut lately" list. Each part links to its tab in Onshape and its system's assembly.
- **Ready to CAM.** When a part's design is done, flag it, on the board or with **Ready to CAM** on a made part in the BOM: how many, and what it's cut from. Pick aluminum or polycarbonate and a thickness (1/32, 1/16, 1/8, 3/16, 1/4 or one typed in), or other stock like a tube. These start from the part's material in the BOM and its thickness in Onshape. A plate that isn't in the stock list yet is added to it. Whoever makes the toolpaths presses **CAM done**, and it's To cut.
- **Sizes and checks from Onshape.** A part's size, thickness and outline are read from Onshape once and kept. From those come a rough router time and design checks against the stock's bit: holes and slots too small for it, inside corners it can't make sharp, the wrong thickness, and parts too big for a sheet.
- **Sheets.** Each sheet has an ID to write on it, like `AL250-007`, and is drawn to scale with its cuts. Tap a cut for what it is, who cut it and when. Cuts come from an Onshape layout, from **Find room**, or are typed in by hand. A leftover piece can be cut off as a remnant with its own ID, and a used-up sheet marked scrap.
- **Stock.** The kinds of stock, like "1/4 in aluminum plate", with each one's code (the start of its sheet IDs), full sheet size and router settings. Anyone adds them, by hand or with **Import from Onshape**, which works out the plates the robot's parts need (see below).

| File | What it does |
|:--|:--|
| `index.ts` | Tells the app about the module, and puts "2 ready to CAM · 5 to cut · 1 cutting" on the home page tile. |
| `data.ts` | The five tables, their example rows, adding and changing them, reading shapes and layouts from Onshape, and finding room. |
| `geometry.ts` | Sizes in inches, where a part from a layout lands on its sheet, fitting parts on a sheet, the biggest leftover piece, router time and design checks. Nothing in it reads or saves rows. |
| `data.test.ts`, `geometry.test.ts` | Tests for both. |
| `CncPage.tsx` | The page, with its three views. |
| `Board.tsx`, `Sheets.tsx`, `StockList.tsx` | The Board, Sheets and Stock views. |
| `SheetDrawing.tsx` | A sheet drawn to scale, with its cuts. |
| `CamStockPicker.tsx` | Picking aluminum or polycarbonate and a thickness, or other stock, when a part is flagged ready to CAM. The BOM's form uses it too. |

The tables are made by `supabase/migrations/20261030120000_cnc.sql`, and their permission rules are tested in `supabase/tests/cnc.test.ts`. Everyone on the team can see everything, add and change stock (`..._cnc_members_add_stock.sql`), add parts to the board and move them along, add sheets, and record cuts. Only mentors delete stock, take parts off the board, and delete sheets. People can delete a planned cut, or a cut they recorded themselves; mentors can delete any.

The database fills in who did things and when, so they can't be faked: who moved a part along, who cut something, who read a shape. When a part is marked cut on the board, the cuts planned for it on sheets become real cuts, and a new sheet becomes "partly used" at its first cut.

## How a sheet's cuts get recorded

1. **Lay the parts out in Onshape.** Make an assembly with the sheet as a part, its corner at the origin and lying on the Top plane, and place the parts on it where they'll be cut. That's also what CAM works from.
2. **Link it.** Paste the assembly's address into the sheet's **Change sheet > Onshape layout assembly**.
3. **Read layout from Onshape.** Each part on the sheet is matched to the BOM, placed using its outline, and saved as a planned cut (dashed on the drawing), given to its job on the board. Parts that aren't in the BOM (like the sheet itself), aren't lying flat, are off the sheet, or are already there are listed as left out.
4. **Mark the part cut on the board.** Its planned cuts become cuts (solid on the drawing), with who and when.

No layout? **Find room** fits the parts waiting for that stock onto the sheet, from the left end so the leftover is one piece at the right, and **Plan them here** saves them as planned cuts. Or **Add a cut** by hand: where it is from the corner with the orange dot, and its size.

## Importing stock from Onshape

**Import from Onshape** on the Stock tab works out the plates the BOM's made parts are cut from, so nobody has to type them in:

- Each part's **material** comes from Onshape through the BOM import. "Aluminum - 6061" and "6061 aluminum, 1/4 in plate" both count as aluminum.
- Each part's **thickness** comes from its shape in Onshape, snapped back to the fraction it was drawn as (0.188 → 3/16).
- Parts that are flat plates (at most 1 in thick, and at least 3 times as wide as they are thick) are grouped by material and thickness, and each group not already in the stock list is offered as a new plate, like "3/16 in aluminum plate" with code `AL188`. Tick the ones to add.
- Parts that aren't plates (shafts, tubes, blocks), or have no material in Onshape, are listed as left out. Tubes and bars are added by hand.

Parts whose shape hasn't been read yet are read first, if you say so: the panel says how many Onshape API calls that takes. A shape is only read once, and then also gives that part's size and checks on the board.

## Onshape and its API limit

Shapes and layouts come through the `onshape` server function (`supabase/functions/onshape/`), which holds the team's keys:

- **shapes** reads parts' edges (`/parts/.../tessellatededges`) and works out each one's size, outline, cut length and the measurements the checks use (`shape.ts`). It costs one call for the Part Studio's part versions, then one per part that changed since it was last read.
- **layout** reads where every part sits in the layout assembly (`/assemblies/...`, each part's place as a matrix). One call.

Onshape limits API calls per year, so Onshape is only asked when someone presses a button, and what comes back is kept. **Update sizes from Onshape** only reads parts that changed. Each answer says how many calls it used.

Onshape's published API (checked October 2026) has nothing for CAM Studio's toolpaths, times or G-code, so the time is worked out from the outline: once round every loop per pass, at the stock's feed. It leaves out pockets, moving between cuts and tool changes, so treat it as a lower bound.

In demo mode the example Intake side plate has a shape, and sheet `AL250-001` is linked to a made-up layout, so everything can be tried without keys.

## Still to do

- Labels with QR codes for sheets, so scanning a sheet opens it
- Drawing real outlines into Find room, not just boxes, to nest parts closer
- Tracking tube and bar lengths the way sheets are tracked
- Times from Onshape CAM Studio, if it gets an API

## Rules

- Anything that talks to Onshape goes in the `onshape` server function, never in the browser, and changes to it need a mentor's review.
- Only call Onshape when someone presses a button, never when a page opens.
- Sizes are inches everywhere. A sheet's length runs along x and its width along y, from the corner at the layout's origin.

Copy the pattern from the [Example module](../example/README.md). Keep each pull request to one step.

**Works with:** BOM (the parts to cut, and their Onshape links).
