# Prescouting

**Partly built.** Before an event, the scouting team looks up every team that's coming and writes down what we know about them. It's in the Competition menu, just above Scouting.

## What works so far

- **The teams at an event** (#116). Type an event key at the top; it starts as `EVENT_KEY` from the Scouting module's `season.ts`, and the phone remembers the choice (`prescoutEventStore`). A Championship division works too: it has its own key. Each team shows its number, name, Statbotics EPA (or "—" if there isn't one yet) and a link to its page on The Blue Alliance. `loadPrescoutTeams()` in `data.ts` gets the teams with `getEventTeams()` and the EPA with `getRatings()`, both from the Scouting module's `data.ts`. If Match 13 has no ratings yet, the teams still show.
- **A page for each team** (#117), at `#/prescouting/<event>/<team>`: their number, name, EPA and TBA link, then open-ended questions (`PRESCOUT_QUESTIONS` in `data.ts`): strengths, weaknesses, key task, expected auto paths, performance and other notes. `savePrescout()` adds the team's row the first time and changes it after that. Whoever saves last wins.
- **Robot photos** (#164): a team's page shows the photos scouts took of their robot from the Scouting pit form, newest first (`useTeamPhotos()` from the Scouting module's `data.ts`).
- **The overview** (#118): a card for each team with their EPA and the first line of their key task, strengths, weaknesses and other notes, or "Not prescouted yet". Tapping a team opens their page. **Mark** (a star) is shared by everyone (`toggleMark()`), and marked teams stay at the top, under a "Marked" heading, above "Everyone else". Sort by team number or EPA (`prescoutOverview()` in `data.ts`).

## The table

`prescouting_notes`, one row per team per event (`supabase/migrations/..._prescouting_notes.sql`, rules tested in `supabase/tests/prescouting-notes.test.ts`). Signed-in members read every row, add one, and change the answers and mark of any; only mentors delete them. Prescouting happens before the event, with Wi-Fi, so it saves straight to the table, not on the phone first like match entries.

- **Linked to Scouting's team page** (#119): a team's prescouting page has a **Scouting team page →** button, and Scouting's team page has a Prescouting panel with the key task, strengths, weaknesses and expected auto paths, and a link back (or "Not prescouted yet"). Other modules read one team's prescouting with `prescoutFor()` / `usePrescoutFor()`, and link to it with `prescoutHref()`, never the table itself. Scouting's team page uses the event Scouting is on, so the prescouting it shows is for that event.

## What it needs next


## Rules

- Test every change at phone size (browser developer tools > device toolbar).
- The Blue Alliance and Match 13 go through the Scouting module's `data.ts`. Don't call them from here any other way.
