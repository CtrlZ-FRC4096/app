# Prescouting

**Partly built.** Before an event, the scouting team looks up every team that's coming and writes down what we know about them. It's in the Competition menu, just above Scouting.

## What works so far

- **The teams at an event** (#116). Type an event key at the top; it starts as `EVENT_KEY` from the Scouting module's `season.ts`, and the phone remembers the choice (`prescoutEventStore`). A Championship division works too: it has its own key. Each team shows its number, name, Statbotics EPA (or "—" if there isn't one yet) and a link to its page on The Blue Alliance. `loadPrescoutTeams()` in `data.ts` gets the teams with `getEventTeams()` and the EPA with `getRatings()`, both from the Scouting module's `data.ts`. If Match 13 has no ratings yet, the teams still show.
- **A page for each team** (#117), at `#/prescouting/<event>/<team>`: their number, name, EPA and TBA link, then open-ended questions (`PRESCOUT_QUESTIONS` in `data.ts`): strengths, weaknesses, key task, expected auto paths, performance and other notes. `savePrescout()` adds the team's row the first time and changes it after that. Whoever saves last wins.
- **The overview** (#118): a card for each team with their EPA and the first line of their key task, strengths, weaknesses and other notes, or "Not prescouted yet". Tapping a team opens their page. **Mark** (a star) is shared by everyone (`toggleMark()`), and marked teams stay at the top, under a "Marked" heading, above "Everyone else". Sort by team number or EPA (`prescoutOverview()` in `data.ts`).

## The table

`prescouting_notes`, one row per team per event (`supabase/migrations/..._prescouting_notes.sql`, rules tested in `supabase/tests/prescouting-notes.test.ts`). Signed-in members read every row, add one, and change the answers and mark of any; student leaders, mentors and admins can delete them. Prescouting happens before the event, with Wi-Fi, so it saves straight to the table, not on the phone first like match entries.

## What it needs next

- Link each team's prescouting page and their Scouting team page both ways (#119), once the team page (#36) is built.

## Rules

- Test every change at phone size (browser developer tools > device toolbar).
- The Blue Alliance and Match 13 go through the Scouting module's `data.ts`. Don't call them from here any other way.
