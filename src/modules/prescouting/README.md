# Prescouting

**Partly built.** Before an event, the scouting team looks up every team that's coming and writes down what we know about them. It's in the Competition menu, just above Scouting.

## What works so far

- **The teams at an event** (#116). Type an event key at the top; it starts as `EVENT_KEY` from the Scouting module's `season.ts`, and the phone remembers the choice (`prescoutEventStore`). A Championship division works too: it has its own key. Each team shows its number, name, Statbotics EPA (or "—" if there isn't one yet) and a link to its page on The Blue Alliance. `loadPrescoutTeams()` in `data.ts` gets the teams with `getEventTeams()` and the Match 13 numbers with `getRatings()`, both from the Scouting module's `data.ts`. If Match 13 has no ratings yet, the teams still show.
- **Match 13 numbers** (#186): `loadPrescoutTeams()` keeps these from each team's Match 13 rating, on `PrescoutTeam` in `data.ts`, or null if Match 13 didn't give one:
  - **xP** (`xp`, Match 13's `xpEnd`): the points the team adds to its alliance's score. Before the event it's Match 13's rating of how strong they are going in; it changes once matches start.
  - **xP rank** (`xpRank`), like "Rank 5 of 40": among the teams at this event that Match 13 rated, best first. Teams with the same xP share a rank.
  - **Auto, Teleop and Endgame** (`auto`, `teleop`, `endgame`): the parts of their xP.
  - **EPA** (Statbotics), and **OPR** and **DPR** (The Blue Alliance: points they score, and points they give up).

  A team's page shows them in a **Match 13** panel (`Match13Panel` in `PrescoutPage.tsx`) above "Our notes", with "—" for any that are missing, a line saying what xP means before the event, and "No Match 13 numbers yet" if Match 13 hasn't rated them. Their consistency, ranking point chances and this season's game parts (#152), and their numbers at earlier events (#153), aren't here yet.
- **A page for each team** (#117), at `#/prescouting/<event>/<team>`: their number, name, EPA and TBA link, then open-ended questions (`PRESCOUT_QUESTIONS` in `data.ts`): overall (#153), strengths, weaknesses, key task, expected auto paths, performance and other notes. `savePrescout()` adds the team's row the first time and changes it after that. Whoever saves last wins.
- **Stars** (#118): a **Star** button on each team's card and page (`Stars.tsx`) opens a small Star window in its place, inside the team's box, pushing the rest of the box down to make room. It asks "Who sees this star?", with two big buttons:
  - **Just for me:** only you see it.
  - **For the whole team:** everyone sees it, with your reason and your name. It can't be saved without a reason. Several people can star the same team, each with their own reason.

  You remove your own stars with the red minus square right after the name (it says "Remove" when you point at it); student leaders, mentors and admins can also remove any team star. Saving goes through `starTeam()` and `unstarTeam()` in `data.ts`. The Scouting module shows the same stars on its Teams page and team pages, so a star in either place shows in both.
- **The overview** (#118): a card for each team with their EPA and xP (#186), their stars, and the first line of their key task, strengths, weaknesses and other notes, or "Not prescouted yet". Tapping a team opens their page. Teams come in three groups, each with a heading: **Team stars**, then **Your stars**, then **Everyone else**. Within each, sort by team number, EPA or xP (`prescoutOverview()` in `data.ts`).
- **Cards or Table:** a **Show as** choice next to Sort by. The phone remembers it (`prescoutViewStore` in `data.ts`), and Cards is the default. **Table** (`TeamTable` in `PrescoutPage.tsx`) is one compact row per team, so several times as many fit on a phone screen:
  - The first column is the team number, which opens their prescouting page, with ★ and how many stars they have (`starCount()`).
  - Then a column for each question in `PRESCOUT_QUESTIONS`, in that order, so a new question gets a column by itself. Each cell is the first line of the answer, cut to `TABLE_ANSWER_LENGTH` characters, or "—". A team that isn't prescouted yet has "—" in every cell.
  - It's wider than a phone, so it scrolls sideways inside its own box (`.table-wrap`), and the page doesn't. The team column stays in place while it scrolls (`.grid-table`, like Attendance).
  - The star groups are heading rows across the table, and the sort and search work the same as in Cards.
- **Find a team:** a search box above the cards narrows the list as you type, by part of the team number ("40" finds 4096 and 1640) or name, ignoring capitals. The headings stay, each showing only the teams that match, and a heading with none is hidden. With no matches it says so. The rule is `searchPrescout()` in `data.ts`.

- **Linked to Scouting's team page** (#119): a team's prescouting page has a **Scouting team page →** button, and Scouting's team page has a Prescouting panel with the key task, strengths, weaknesses and expected auto paths, and a link back (or "Not prescouted yet"). Other modules read one team's prescouting with `prescoutFor()` / `usePrescoutFor()`, and link to it with `prescoutHref()`, never the table itself.
- **Robot photos** (#164): a team's page shows the photos scouts took of their robot from the Scouting pit form, newest first (`useTeamPhotos()` from the Scouting module's `data.ts`).
- **Overall** (#153): the first question on a team's page is a summary, like "Strong scorer, inconsistent climb, good second pick", and it shows first on the overview card. It's the `overall` column, added by `..._prescouting_notes_overall.sql`.
- **A team's season** (#153), at the bottom of a team's page (`TeamSeason.tsx`): their averages from matches scouted from video this season, then every event they've been to or are going to this year (newest first, each linked to The Blue Alliance, with their Match 13 xP and rank there). Tap **Matches** on an event to see their matches there in the order they're played, with alliance, result and **Watch ↗** links, the event's averages, and what each scout saw (with their name). **Scout it** on a played match fills in the season's counters, endgame and roles from Scouting's `season.ts`, the same as the match form, and notes. Each scout has their own row per match; saving again changes it. In `data.ts`: `seasonMatches()`, `savePrescoutMatch()`, `usePrescoutMatches(team)` and `prescoutAverages()` (two scouts on the same match count as one match). The events come from `getTeamEvents(team, year)` and the xP from `getTeamSeasonRatings()`, both in Scouting's `data.ts`.
- **Strategy team only** (#167): Prescouting is hidden from the menu and home page for anyone off the strategy team (student leaders, mentors and admins always count), and its page says "Only the strategy team and mentors can see this." The database's rules on all its tables only let the strategy team read and write them.

## The tables

Prescouting happens before the event, with Wi-Fi, so both save straight to the database, not on the phone first like match entries.

- `prescouting_notes`: our answers, one row per team per event (`supabase/migrations/..._prescouting_notes.sql`, rules tested in `supabase/tests/prescouting-notes.test.ts`). The strategy team (#167) reads every row, adds one, and changes the answers of any; student leaders, mentors and admins can delete them.
- `prescouting_stars`: one row per star (`supabase/migrations/..._prescouting_stars.sql`, rules tested in `supabase/tests/prescouting-stars.test.ts`). A star just for you is seen only by you; team stars are seen by the whole strategy team (#167), and the database refuses one with no reason. Members star as themselves, and remove their own stars; student leaders, mentors and admins also remove any team star, like the other Scouting and Prescouting permissions (#187). Nobody changes a star: remove it and star again. This migration replaced the old shared `marked` column: marks became team stars with the reason "Marked before stars were added".

- `prescouting_matches`: what each scout saw of a team in one match from video (#153; `supabase/migrations/..._prescouting_matches.sql`, rules tested in `supabase/tests/prescouting-matches.test.ts`). The strategy team reads every row, adds their own and changes or removes their own; student leaders, mentors and admins can remove anyone's.

## Rules

- Test every change at phone size (browser developer tools > device toolbar).
- The Blue Alliance and Match 13 go through the Scouting module's `data.ts`. Don't call them from here any other way.
