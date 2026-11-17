# Pit checklist

The page the pit crew uses at an event to get the robot ready for each of
our matches (#146). It used to be called Robot status. The folder and id
are still `status`, so links and other code keep working.

The subsystem progress grid used to be here too. It moved to its own module,
[Build progress](../progress/README.md), under the Build menu (#65).

## What it does

- **Our matches.** The top of the page lists our matches still to play,
  from the event schedule: when (like Sat 10:42 AM), whether we're red or
  blue, and Match 13's prediction. Each says **Ready** when every item is
  checked for it, or how many are left ("3 of 14 left"). Our next match is
  chosen to start with; tap another to choose it.
- **The practice round.** "Practice / no match" is always at the end of the
  list, and is the one chosen when there's no schedule (the event hasn't
  started, or there's no connection and nothing saved). The checklist
  works the same.
- **Students** see only the items assigned to them, checked for the chosen
  match, with "You're done for Qual 12" once they're all checked. If
  nothing is assigned to them, the page says so.
- **Student leaders, mentors and admins** see each person's progress
  (Alex: 4 of 5), what's still to do grouped by who it's assigned to
  (unassigned items first, so they stand out), and the full checklist,
  which they run: see "Who can do what" below.
- **The home page tile** says whether we're ready for the next match:
  "Ready for Qual 12", or "3 of 14 left for Qual 12".

Each match starts with a fresh checklist: a check is for one item and one
match. The checks left behind are a record of what was done before each
match.

## Who can do what

| | Students | Student leaders, mentors and admins |
|:--|:--|:--|
| See their own items and check them | Yes | Yes |
| See everyone's progress and the full checklist | | Yes |
| Check or uncheck any item | | Yes |
| Add, rename, assign, reorder and remove items | | Yes |
| Change who's on an item (the People popup) | | Yes |
| Change an item's subgroup, and who's in each subgroup (the Subgroups panel) | | Yes |
| Clear list: uncheck everything, or remove every item | | Yes |

A student who tries is told who to ask, like "Ask a student leader or
mentor to rename this item." The page decides who sees what with
`canManagePit()` in `data.ts`, which is `isLeader()`. Hiding the buttons is
only tidiness: the database's rules below are what stop anyone else.

## The full checklist (student leaders, mentors and admins)

Drag the handle at the right edge of an item to reorder it with a mouse or
touch. Keyboard users can focus the handle and press Up or Down. The
destination row is previewed while dragging, drops settle smoothly, with
automatic scrolling at the viewport edges, and reduced-motion preferences
turn the transitions off. Releasing outside the list cancels the move.

Each item's three-dot menu has **Move to…** (type a position and press
**Move**; `movePitItemTo()` checks it's from 1 to the number of items),
**Rename** and **Remove**. Escape closes the menu. Remove asks first (a
second tap), and takes the item's checks with it (`removePitItem()`).

**People.** Each item shows its people as name tags, or **+ Add people**
when it has none. The tags are one button: tap it to open the **People**
popup (a mode of `ItemPopup.tsx`), with no ⋯ menu in the way:

- The chosen people are at the top. Tap one (it has a ×) to take them off.
- **Find someone** is under them, ready to type in when the popup opens.
  Enter adds the first name listed.
- Under it are the people who can be added: the item's subgroup members.
  Tap a name to add it. Nothing is a checkbox.
- For **General** items, where anyone can be chosen, it lists the people
  already on other items, and everyone else only once a name is typed
  (`pickablePeople()` and `assignedPeople()` in `data.ts`).

Changes save straight away. Clearing everyone leaves the item unassigned,
and changing who's on an item never unchecks it. The picker is
`PeoplePicker.tsx`, and the **Add an item** form uses the same one. In the
form, picking a subgroup takes off anyone who isn't in it, and says so:
"You're not in Electrical, so you were taken off." (`takenOffText()`).

**Subgroups**, a panel at the bottom of the page (`SubgroupsPanel.tsx`),
has a row for each subgroup with its people as name tags. Tap a row to
change them in the same picker. Taking someone out of a subgroup also takes
them off that subgroup's items. General isn't listed: it's always everyone.

**Clear list**, under the checklist, opens a small popup with two choices.
Each says how many items it affects and needs a second tap:

- **Uncheck everything** unchecks every item for the chosen match
  (`uncheckAllPitItems(matchKey)`). The items, their people and other
  matches' checks stay. Each match already starts unchecked, so this is
  mostly for the practice round, which is used again and again.
- **Remove every item** empties the list for everyone, with every check
  (`clearPitChecklist()`).

Each item shows a subgroup tag: General, Mechanical, Electrical,
Programming or Drive team. Tap it to change the subgroup. People not in
the new subgroup come off the item.

## Where it's saved

In the team database, so everyone sees the same checklist and checks
straight away (`supabase/migrations/..._pit_checklist.sql`):

- `pit_checklist_items`: the items, with `assignee_ids` (who each is
  assigned to) and `position`.
- `pit_checklist_checks`: one row per item checked for a match:
  `item_id`, `match_key` (like `2026ilch_qm12`, or `practice`), and who
  checked it and when (`created_by`, `created_at`).

The database's rules, tested in `supabase/tests/pit-checklist.test.ts`:

- Everyone on the team reads the items and every check.
- Student leaders, mentors and admins add, rename, assign, reorder and
  delete items, and check or uncheck any item
  (`..._pit_checklist_student_leaders.sql`, which swapped the mentor-only
  rules the first migration made).
- A student can only check or uncheck items assigned to them. The database
  refuses anything else.

**Who's in each subgroup** is still saved in each browser, not the
database: a student leader or mentor sets it on their own device, in the
Subgroups panel. A subgroup nobody has set up on that device lists
everyone. It only decides who shows in the assignment lists.

**Items from the old local preview** (saved in a browser before this
change) aren't moved over. They stay in that browser's storage, unused.
The checklist starts from what's in the team database; a student leader
or mentor adds the items again there.

## How the matches work

The schedule comes from the Scouting module's `data.ts` (not its pages):
`keepScheduleFresh()` keeps it up to date while the page is open,
`useSavedSchedule()` reads the copy saved on this device, so it works with
no connection, and `matchesWithPredictions()` puts each match with Match
13's prediction. The event is the one chosen in Scouting (`currentEvent()`,
`EVENT_KEY` in `season.ts` until someone picks one).

## Still to do

- Tiles showing each other module's summary (low stock, short BOM lines,
  and so on), built from each module's `useSummary` hook.
- A big-screen view for the pit TV.
- Saving subgroup members in the team database, so they're set once.
- Select several items and give them to the same people.
- Should the checklist show which battery is in the robot (the Batteries
  module)?

**Works with:** Scouting (the schedule), every module through their
`useSummary` hooks (later).
