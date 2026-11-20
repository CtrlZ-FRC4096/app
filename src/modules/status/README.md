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
  chosen to start with; tap another to choose it. One of ours still waiting
  for its score after a later match has one counts as played, so the
  checklist, the home tile and the pit display all pick the same next match.
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
- **The pit display**, for a TV or laptop in the pit: see below.

Each match starts with a fresh checklist: a check is for one item and one
match. The checks left behind are a record of what was done before each
match.

## The pit display

A page to leave open on a TV or laptop in the pit at an event (#161), so
anyone walking past can see when our next match is, who we're with and
against, and whether we're ready. It's at `#/status/display`: Competition →
Pit checklist → **Pit display** in the menu. Nobody needs to touch it.

**What it shows**, biggest first:

- **Our next match** and our alliance, in its colour: "Qual 24 · Red".
- **The time until it's expected to start**, the biggest thing on the
  screen: "18 min", counting down to The Blue Alliance's expected start
  (`predicted_time`, which moves as the event runs late or early), with
  "Expected 10:42 AM" under it. Once that time has passed and the match has
  no score yet, it says "Any minute now". With no expected time, "Time not
  known yet".
- **How many matches away** it is, like "3 matches away" or "Up next",
  counted from the last match with a score. That's often more reliable than
  the time when the event runs late. TBA posts scores a few minutes after a
  match, so this can be one match behind.
- **Queue now**: at 2 matches away or fewer, the card changes colour and
  says so. The number is `QUEUE_AT` in `data.ts`.
- **Ready** or "3 of 14 checklist items left", from this checklist, for that
  match. The checklist is in the team database, so with no connection this
  one line goes away and the rest of the display stays.
- **Both alliances**, ours and theirs: each team's number, name, rank and
  record ("Rank 6 · 5-2-0"), and its Match 13 xP ("48.6 xP"), or
  Statbotics' EPA when Match 13 has no xP. A team without one says "not
  rated"; one not in the rankings, "Not ranked yet".
- **How we're doing**: "Rank 6 of 42 · 5-2-0", and our last result, like
  "Last: Qual 18 · Won 84–71".
- **Coming up**: our next 3 matches after this one (`COMING_UP`), with their
  expected times, alliance and partners.
- It **never** shows Match 13's predictions (who's likely to win, or the
  predicted score).

**Instead of a next match** it says "Getting the schedule…" while it loads,
"Schedule not out yet" before The Blue Alliance has the schedule, "4096
isn't on the schedule" (the wrong event is picked), "Quals done" with our
rank after our last qual, and "No match scheduled for us yet" between
playoff matches. Playoff matches show once The Blue Alliance has them.

**Keeping itself up to date.** While it's open, it gets the schedule every
2 minutes, the rankings every minute, Match 13's ratings every 5 minutes,
and the teams' names once (and again when the device comes back online).
The countdown ticks every 30 seconds without asking the network. Times are
in the device's own time zone, like Scouting's Schedule page, which is the
event's when the device is there. "Updated 2 minutes ago" is in the top
corner; with no Wi-Fi it shows the copy saved on the device, and once that's
more than 10 minutes old the line turns red and says the times may be out of
date, with the reason the last try to get the schedule didn't work (or, with
no reason, to check the device's connection).

**Setting up the TV:**

1. Sign in on the laptop, and open Competition → Pit checklist → Pit display.
2. Press **Full screen** (top right). Only the display shows, without the
   app's top bar. Esc leaves; after a reload, press it again (browsers only
   allow full screen after a click). There's no Full screen button on an
   iPhone, which can't do it.
3. To make everything bigger, pick Larger or Largest under Size at the
   bottom of the home page. Check on the TV that it all still fits on the
   screen: nobody scrolls a display.
4. The screen stays on by itself where the browser allows it (the Screen
   Wake Lock API). If the laptop still sleeps, set it not to sleep while
   plugged in.
5. It shows the event picked in Scouting. A device that has never opened
   Scouting shows the one in `season.ts`, and says so: open Scouting on it
   once, with a connection.

**The code.** The sums are `pitDisplay()` in `data.ts`, a plain function
with the time passed in, so the tests use a fixed time. `PitDisplay.tsx` only
shows what it gives back. The example schedule's times are in March 2026, so
in demo mode the countdown says "Any minute now".

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
  (`assignedPeople()` in `data.ts`, and `pickablePeople()` in
  `src/core/members.ts`).

Changes save straight away. Clearing everyone leaves the item unassigned,
and changing who's on an item never unchecks it. The picker is
`PeoplePicker` in `src/core/ui.tsx` (shared with Training's "Sign people
off" form), and the **Add an item** form uses the same one. In the
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

The pit display also reads the rankings (`useRankings()`), Match 13's
ratings (`useRatings()`, `loadRatings()`) and the teams' names
(`useSavedEventTeams()`, `loadEventTeams()`), all saved on this device. It
passes no predictions to `matchesWithPredictions()`, so none can show.

## Still to do

- Tiles showing each other module's summary (low stock, short BOM lines,
  and so on), built from each module's `useSummary` hook.
- Saving subgroup members in the team database, so they're set once.
- Select several items and give them to the same people.
- Should the checklist show which battery is in the robot (the Batteries
  module)?
- The pit display: Nexus's live queue status (`useNexusStatus()`) where the
  event uses Nexus, which is quicker than TBA's scores. Hiding the app's top
  bar without pressing Full screen needs a change to the app's layout (a
  mentor). Following the team's event on a device that has never opened
  Scouting needs Scouting's event sync moved into its `data.ts`.
- The checklist's match times (`matchTime()`) are in Chicago time; the
  display's are in the device's own, like Scouting's Schedule page.

**Works with:** Scouting (the schedule, rankings, Match 13 ratings and team
names), every module through their `useSummary` hooks (later).
