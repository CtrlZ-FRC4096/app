# Prescouting

**Partly built.** Before an event, the scouting team looks up every team that's coming and writes down what we know about them. It's in the Competition menu, just above Scouting.

## What works so far

- **The teams at an event** (#116). Type an event key at the top; it starts as `EVENT_KEY` from the Scouting module's `season.ts`, and the phone remembers the choice (`prescoutEventStore`). A Championship division works too: it has its own key. Each team shows its number, name, Statbotics EPA (or "—" if there isn't one yet) and a link to its page on The Blue Alliance. `loadPrescoutTeams()` in `data.ts` gets the teams with `getEventTeams()` and the EPA with `getRatings()`, both from the Scouting module's `data.ts`. If Match 13 has no ratings yet, the teams still show.
- **A page for each team** (#117), at `#/prescouting/<event>/<team>`: their number, name, EPA and TBA link, then open-ended questions (`PRESCOUT_QUESTIONS` in `data.ts`): strengths, weaknesses, key task, expected auto paths, performance and other notes. `savePrescout()` adds the team's row the first time and changes it after that. Whoever saves last wins.
- **Stars** (#118): a **Star** button on each team's card and page (`Stars.tsx`) opens a small Star window in its place, inside the team's box, pushing the rest of the box down to make room. It asks "Who sees this star?", with two big buttons:
  - **Just for me:** only you see it.
  - **For the whole team:** everyone sees it, with your reason and your name. It can't be saved without a reason. Several people can star the same team, each with their own reason.

  You remove your own stars with the red minus square right after the name (it says "Remove" when you point at it); student leaders, mentors and admins can also remove any team star. Saving goes through `starTeam()` and `unstarTeam()` in `data.ts`. The Scouting module shows the same stars on its Teams page and team pages, so a star in either place shows in both.
- **The overview** (#118): a card for each team with their EPA, their stars, and the first line of their key task, strengths, weaknesses and other notes, or "Not prescouted yet". Tapping a team opens their page. Teams come in three groups, each with a heading: **Team stars**, then **Your stars**, then **Everyone else**. Within each, sort by team number or EPA (`prescoutOverview()` in `data.ts`).

## The tables

Prescouting happens before the event, with Wi-Fi, so both save straight to the database, not on the phone first like match entries.

- `prescouting_notes`: our answers, one row per team per event (`supabase/migrations/..._prescouting_notes.sql`, rules tested in `supabase/tests/prescouting-notes.test.ts`). Signed-in members read every row, add one, and change the answers of any; student leaders, mentors and admins can delete them.
- `prescouting_stars`: one row per star (`supabase/migrations/..._prescouting_stars.sql`, rules tested in `supabase/tests/prescouting-stars.test.ts`). A star just for you is seen only by you; team stars are seen by every member, and the database refuses one with no reason. Members star as themselves, and remove their own stars; student leaders, mentors and admins also remove any team star, like the other Scouting and Prescouting permissions (#187). Nobody changes a star: remove it and star again. This migration replaced the old shared `marked` column: marks became team stars with the reason "Marked before stars were added".

## What it needs next

- Link each team's prescouting page and their Scouting team page both ways (#119), once the team page (#36) is built.

## Rules

- Test every change at phone size (browser developer tools > device toolbar).
- The Blue Alliance and Match 13 go through the Scouting module's `data.ts`. Don't call them from here any other way.
