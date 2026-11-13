# Scouting

**Partly built.** Match scouting for events. It has to work with no Wi-Fi: entries save on the device and sync when there is a connection.

## What works so far

- The match form, drawn from `season.ts`: observed auto (where it started, from `AUTO_SIDES`, and what it did), counters, role (choose any) and how well it does it, broke down and what broke (`BREAKDOWN_PARTS`, plus a box for anything else), died or browned out, E-stop, A-stop or both, driver skill, endgame, the bonus ranking points its alliance earned (`RANKING_POINTS`: check the names with the scouting lead) and notes (#162). Entries saved on phones before #162 don't have the new answers; `toRow()` sends them as empty or "no", and the `..._scouting_entries_more_questions.sql` migration adds the columns.
- The team fills in from the schedule (#40). The scout picks their position once (Red 1 to Blue 3), and the phone remembers it (`positionStore` in `data.ts`). Typing the match number fills in the team for that position and shows it big, in the alliance's colour, to check against the robot's bumpers. The scout can still change it. This is `MatchTeamFields.tsx`.
  - The schedule comes from `loadSchedule()` when the form opens. It saves the qualification matches on the phone (`scheduleStore`), so it keeps working with no Wi-Fi once it's loaded. With no saved copy (no Wi-Fi the first time, or The Blue Alliance doesn't have the schedule yet) the form says so, and the scout types the team in.
  - `teamFor()` finds the team for a match and position.
- Save entry: `saveEntry()` in `data.ts` keeps the entry on this device, marked Waiting. It refuses an entry with no team or match number, or no driver skill chosen.
- A list of the entries saved on this device, newest first, each Waiting or Synced
- Syncing (#31): Waiting entries are sent to the team database by themselves, with nothing to press:
  - right after saving, if there's a connection
  - when the phone comes back online
  - when the app is opened or comes back on screen
  - every minute while any are waiting

  A **Send now** button is there too, but it's never needed. Entries need someone signed in on the phone to send.
- Event rankings (#39), at `#/scouting/rankings` (`RankingsPage.tsx`): rank, team, record and ranking points (RP), best first. `useRankings()` in `data.ts` gets them through `getRankings()` while the page is open: right away, every minute, when the app comes back on screen and when the phone comes back online. It keeps the last ones on the device (`rankingsStore`), so with no Wi-Fi they still show, with "Updated 10 minutes ago". The forms stay on the page, hidden, so going to the rankings doesn't lose what's typed. Tapping a row opens that team's page. `rankOf(rankings, team)` finds one team: the team page shows it at the top (`TeamRank.tsx`), like "Rank 3 of 42 · 5-1-0", with when the rankings are from. It uses `useRankings()` too, so the rankings also update while a team page is open.
- The match schedule (#107, `Schedule.tsx`, at `#/scouting/schedule`): every match at the event from The Blue Alliance, with Match 13's prediction for each, like "Red 72%" and the predicted score. Played matches show the real score instead, and a match Match 13 hasn't predicted yet shows "No prediction yet". Our matches are highlighted, and **Just ours** hides the rest. The page only shows; `data.ts` does the work:
  - `matchesWithPredictions()` matches each prediction to its match by key and puts them in the order they're played.
  - `refreshSchedule()` gets both and saves them on the device (`scheduleStore`), so with no connection the page shows the last ones with when they're from. Other features that need the schedule offline, like #40, can read it with `savedSchedule()`.
  - `keepScheduleFresh()` asks again every 2 minutes while the page is open, when the app comes back on screen, and when the phone comes back online. (The `match13` function reuses its answer for 2 minutes, so asking more often doesn't help.)
- A Match / Pit / Schedule / Rankings / Picklist / Final picklist switch at the top of the page. The choice is in the address: `#/scouting` is the match form, `#/scouting/pit` the pit form, `#/scouting/schedule` the schedule, `#/scouting/rankings` the rankings, `#/scouting/picklist` the picklist and `#/scouting/shared-picklist` the final picklist. Each form is one panel, with a line between its sections (`FormSection.tsx`). The pit form (`PitForm.tsx`) asks for the team, drivetrain, weight and size, motors, what the robot can see, preferred auto and strategy. Its choice lists are `DRIVETRAINS`, `VISION` and `AUTO_SIDES` in `season.ts`. Choosing the **Other** drivetrain shows a box to type it (#163); the team page's drivetrain bar counts typed ones, and any no longer in `DRIVETRAINS`, as Other, and lists the typed name with the pit answers. Vision is marked as a maybe in the requirements: check it with the scouting lead. Pit entries saved before #163 sync with these empty (`pitToRow()`). Save pit entry: `savePitEntry()` in `data.ts` keeps it on this device (`pitStore`). It needs a team number; the match number is optional. Pit entries are sent to the team database the same way as match entries (#35): `syncEntries()` sends both, to the `scouting_pit_entries` table (`supabase/migrations/..._scouting_pit_entries.sql`, rules tested in `supabase/tests/scouting-pit-entries.test.ts`). Every visit to a team is kept. Both forms show what's saved on this device, Waiting or Synced, with `SavedOnDevice.tsx`.
- A team page (#36, `TeamPage.tsx`), at `#/scouting/team/9991`: everything scouted about one team at this event (`EVENT_KEY`). Type a team number, tap a team from the list of scouted teams, or tap "Team 9991" in the list of saved entries or on the Rankings page. It shows:
  - **Rank** (#39, `TeamRank.tsx`), at the top: the team's place in the event rankings and its record, like "Rank 3 of 42 · 5-1-0"
  - **Numbers**: each counter in `season.ts`, its average per match and each match's count
  - **How often**: bars for endgame, role, driver skill, E-stop or A-stop, what broke (out of the times it broke down), auto starting side, ranking points, and drivetrain (from the pit form), and how often it broke down or browned out
  - **Written answers**: match notes and pit answers, newest first, with who wrote them
  - **Match 13** (#37, `TeamRatings.tsx`): the team's xP rank at the event ("Rank 3 of 42"), its xP and how much it changed since the event started, the Auto / Teleop / Endgame parts, Statbotics' EPA and the win-loss-tie record, with when the numbers are from and a **Refresh** button. It reads the saved copy from `useRatings()` (see "One team's numbers" below), so with no connection it shows the saved numbers and says so. A team Match 13 hasn't rated shows "No Match 13 rating yet", and a part Match 13 left out shows "not given".

  The sums are `teamSummary()` in `data.ts`, a plain function so the picklist can use the same numbers. Adding a counter to `season.ts` adds it to the page with no other change. It counts this event's match and pit entries from the team database plus this phone's Waiting ones; two scouts watching the same robot count as two entries. `pitAnswers()` and `pitDrivetrain()` are the only code that reads a pit entry's answers. Each panel is its own component, so new ones (like Match 13's numbers or match videos) go below the others.
- The picklist (#42, `Picklist.tsx`, at `#/scouting/picklist`): every team at the event ranked best first, from our scouting and Match 13. See "Picklist score" below.
- The final picklist (#43, `SharedPicklist.tsx`, at `#/scouting/shared-picklist`): the order the strategy team wants to pick teams in, shared by every phone. See "Shared picklist" below.
- The match simulator (#166, `Simulator.tsx`, at `#/scouting/simulate`): see "Average points and the simulator" below.
- The stats table (#152, `StatsTable.tsx`, at `#/scouting/stats`): every team's Match 13 numbers in one table. See "More of Match 13's numbers" below.
- The Competition menu lists Match, Pit, Schedule, Rankings, Teams, Picklist, Final picklist, Simulator and Stats under Scouting (`pages` in `index.ts`).
- Match videos (#41): `useTeamQualVideos(team)` in `data.ts` gives a team's qualification matches in order, each with its alliance, Won / Lost / Tied (or not played yet), the scores, and a YouTube link for each video. A played match with no links has no video on The Blue Alliance yet. It loads when the page opens, and `reload()` is for a "Check again" button. The **Match videos** panel on the team page (`TeamVideos.tsx`) shows one line per qual, like "Qual 12 · Red · Won 84–71", with a **Watch ↗** button that opens the video in YouTube in a new tab ("Watch (2) ↗" for a second video), "No video yet", or "Not played yet". It's only links, no video players or thumbnails, to keep the page light on venue Wi-Fi. `VideoList` draws the lines from rows, so tests can use made-up ones.
- Prescouting is its own module, just above Scouting in the Competition menu: see [its README](../prescouting/README.md). It gets the teams and EPA from `getEventTeams()` and `getRatings()` here.

Entries are kept on the device in a store (`entryStore` in `data.ts`), not a table from `createTable()`, because a table needs a connection on the live site. `syncEntries()` sends the Waiting ones to the `scouting_entries` table (`supabase/migrations/..._scouting_entries.sql`, rules tested in `supabase/tests/scouting-entries.test.ts`) and marks them Synced.

Each entry keeps the id its phone gave it, and the table skips an id it already has (`insertOnce()` in `src/core/table.ts`), so an entry sent twice is never saved twice. Everyone on the team can read every entry; only mentors change or delete them.

Don't raise `entryStore`'s version while entries are waiting on phones: entries saved under the old version would be ignored.

### Shared picklist (#43)

The picklist the strategy team reorders on alliance selection day is saved in the `scouting_picklist` table (`supabase/migrations/..._scouting_picklist.sql`, rules tested in `supabase/tests/scouting-picklist.test.ts`), so every phone shows the same order and changes appear by themselves. Everyone signed in can read it; only mentors and admins can change it. Each event has its own list, and a team is on it once.

The functions are in the "Shared picklist" part of `data.ts`:

| Function | Does |
|:--|:--|
| `usePicklist()` | The event's list, top first |
| `startPicklist(teams)` | Starts an empty list with these teams, best first. Refuses if the list already has teams |
| `addMissingTeams(teams)` | Adds the teams that aren't on the list to the bottom |
| `moveTeam(id, -1 or 1)` | Moves a team one place up or down. Nothing happens at the top or bottom |
| `setPickStatus(id, status)` | Marks a team Open, Picked (on another alliance) or Do not pick. It keeps its place |

Each team has a `position`, smallest at the top, starting 1000 apart. A move changes only the moved team's position, to halfway between its new neighbours (`positionBetween()`), so two people moving different teams at once don't undo each other. If the halves get too close to tell apart, `moveTeam()` numbers the list 1000, 2000, … again. Only `position` and `status` can be changed, so not even a mentor can turn a row into a different team or event.

The page is `SharedPicklist.tsx`. Everyone signed in sees the list: rank, team (tap it for the team page) and status. Picked and Do not pick teams stay in their place, greyed out, and **Hide picked** hides the Picked ones. Mentors and admins also see:

- **Start from the ranked list** when the list is empty: it starts with the teams on the Picklist page, in the order that mentor's weights give on their phone (`useRankedPicklist()`).
- **Add teams not on the list** when the ranked list has teams the picklist doesn't.
- Big up and down buttons on each team, which wait while a move saves, and an Open / Picked / Do not pick choice. Screen readers hear "Moved team 9991 to place 2."

Hiding the buttons is only tidiness: the table's rules are what stop anyone else changing the list.

## Average points and the simulator (#166)

Each counter in `season.ts` can have `points` (what the alliance gets for
each one), and `ENDGAME_POINTS` gives each endgame choice's points. Check
them against the game manual with the scouting lead.

| In `data.ts` | Does |
|:--|:--|
| `entryPoints(entry)` | One match entry's points: each counter times its points, plus the endgame's |
| `teamAps(team, entries)` | A team's average points per match (APS) at this event, with a range of one standard deviation either side and how many matches it's from. Two scouts on the same match count once. `null` if not scouted in a match |
| `teamPoints(team, entries, ratings)` | What we expect a team to score: our APS, or Match 13's xP when we've scouted them in fewer than `MIN_MATCHES` (3) matches. `fewMatches` marks those as a guess |
| `allianceScore(teams)` | An alliance's expected score and range. Teams with nothing to go on count as 0 and are listed in `unknown` |
| `redWinChance(red, blue)` | The chance red outscores blue, from 0 to 1, assuming scores spread in a bell curve |
| `useTeamPoints()` | For a page: `pointsFor(team)` from this event's entries and the saved Match 13 copy, so it works with no Wi-Fi |
| `upcomingMatches(schedule)` | The qualification matches not played yet, from the saved schedule |

The team page shows "APS 34 (26–41) from 6 matches", with Match 13's xP
beside it. APS is also a picklist part. The simulator page takes 3 teams a
side (or one side only), or fills them in from an upcoming match, and shows
each alliance's expected score and who's likely to win. It only adds teams
up: it doesn't count defense or robots getting in each other's way, and
says so.

## What it needs to do

- A form for one robot in one match, with big buttons for phones
- Entries save on the device first and sync later
- A QR code for a waiting entry, so another device can copy it with no network
- ~~The match schedule from The Blue Alliance~~ (done, #107)
- The form's fields come from a season settings file, so a new game means new settings, not new code
- Export entries as CSV

## Rules

- Test every change at phone size (browser developer tools > device toolbar).
- Don't put a Blue Alliance key in the browser code. Use the functions in `data.ts` below instead.

## The event

A mentor picks the event the whole team is scouting, at the top of every
Scouting page (**Change event**, `EventPicker.tsx`). It lists our events this
season and next from The Blue Alliance, with a search for any other event by
name, city or key, like a World division. Every phone switches to it
straight away: the schedule, rankings, Match 13 numbers, team pages and
picklists are for it, and new entries are saved under it.

- **Where it's kept:** each pick is a row in the `scouting_events` table
  (`supabase/migrations/..._scouting_events.sql`, rules tested in
  `supabase/tests/scouting-events.test.ts`): everyone reads it, only mentors
  and admins add to it, and nobody changes or deletes a pick. The newest is
  the current event.
- **In code:** `currentEvent()` in `data.ts` gives its key, and
  `useCurrentEvent()` gives it to a page, which redraws when a mentor picks
  another. Functions that take an event use the current one when you leave
  it out. `chooseEvent()` picks one, and `getOurEvents()`, `getAllEvents()`
  and `searchEvents()` look them up.
- **With no Wi-Fi:** the match form never waits for the table. The current
  event is kept on each phone (`eventStore`), and `EventSync` in
  `EventPicker.tsx` keeps that copy up to date while Scouting is open with a
  connection. So **open Scouting once with a connection after the event is
  picked**, before going somewhere with no Wi-Fi.
- **Until a mentor picks one,** it's `EVENT_KEY` in `season.ts`, and the
  top of the page says so.

## The Blue Alliance

`data.ts` already gets these from The Blue Alliance, through the `tba`
server function, which holds the team's key (see "Server functions" in
`supabase/README.md`):

| Function | Gives you |
|:--|:--|
| `getSchedule()` | The event's matches: who's red and blue, and the scores once played |
| `getRankings()` | The event's rankings, best first |
| `getEventTeams()` | Every team registered for the event, by number, before the schedule is out |
| `getTeamMatches(team)` | One team's matches at the event, with their videos |
| `getTeam(team)` | A team's nickname and home |

Each returns `{ ok: true, value }` or `{ ok: false, error }`. The event is
the one the team is scouting (see "The event" below). In demo mode they
return made-up example teams and matches, so you can build pages without a
key.

## Match 13

[Match 13](https://match13.com) rates each team with **xP** ("expected
points"): how many points it adds to its alliance's score. `data.ts` gets
these through the `match13` server function, which holds the team's key:

| Function | Gives you |
|:--|:--|
| `getRatings()` | Every team's rating at the event, best first. Each also has Statbotics' EPA and The Blue Alliance's OPR to compare |
| `getPredictions()` | Each match's predicted scores, and the chance red wins |

They work like The Blue Alliance's above: same `EVENT_KEY`, same
`{ ok, value }` answers, and made-up example data in demo mode. Match 13
has no schedule or team names: get those from The Blue Alliance and match
them up by the match `key` or the team number.

### One team's numbers (#37)

For a team page or the picklist, don't call `getRatings()` from the page.
Use the saved copy instead: one request gets every team, and it still
shows with no Wi-Fi.

| In `data.ts` | Gives you |
|:--|:--|
| `useRatings()` | Every team's rating (Match 13) and ranking (The Blue Alliance) at `EVENT_KEY`, saved on this device. Loads when nothing's saved, when the copy is over 5 minutes old (`STALE_MS`), and when the phone comes back online. Has `loading`, `error`, `loadedAt` and `refresh()` for a Refresh button |
| `teamRating(ratings, team)` | One team's rating, xP rank (tied teams share a rank), how many teams were rated, and the change since the event started. `null` means "No Match 13 rating yet" |
| `teamRecord(rankings, team)` | Their wins, losses and ties, or `null` |
| `signed(n)` | A change like "+4.6" or "−1.4" |
| `savedWhen(loadedAt)` | When the saved numbers are from, like "Today at 3:40 PM" |

### More of Match 13's numbers (#152)

Match 13 sends more than we first used. `Match13Rating` now also has
`xVar` (how much a team's score varies: lower is steadier), `xRp1` to
`xRp3` (the chance of each ranking point) and `components` (this season's
game in parts, named the way Match 13 names them). Match 13's docs give
the names but not their meanings, so these are our reading: **check them on
match13.com, and ask the strategy team which they want**, before relying
on them. They're optional, because copies saved on phones before #152 don't
have them; a missing one shows "not given".

| In `data.ts` | Does |
|:--|:--|
| `STAT_COLUMNS` | The numbers every season has, in the stats table's order, with which are lower-is-better and which are chances |
| `statColumns(ratings)` | Those, then a column for each game part any team has |
| `statValue(rating, key)`, `statText(value, column)` | One team's number, and as text ("48.6", "72%" or "not given") |
| `ratingComponents(rating)` | The game parts, leaving out anything that isn't a number |
| `sortStats(ratings, column, bestFirst)` | Sorts by a column, best first or the other way round; missing numbers go last |

The team page's Match 13 panel shows OPR, DPR and all of these. The stats
page shows them for every team: tap a heading to sort, tap a team to open
its page. Only the table scrolls sideways on a phone. Anything from Match
13 endpoints we don't ask for yet (like its event simulation) needs a
mentor to allow it in the `match13` server function first.

If a load doesn't work, the last copy stays and `error` says why. Match 13
having nothing for the event yet isn't an error: nobody's rated yet. A copy
saved for another event counts as nothing saved. "Reset example data" may
clear the copy; that's fine, it loads again.
- Scouting data is visible to signed-in team members only.

## Picklist score (#42)

The picklist page (`Picklist.tsx`) shows every team in Match 13's ratings
or our entries at this event, ranked, as one card each: rank, team and
score, the numbers behind the score, how many matches we scouted, and a
"No scouting yet" or "No Match 13 rating yet" note. Tapping a card opens
the team page. A folded-away **Weights** panel has a 0 to 5 stepper for
each part; changing one re-sorts the list straight away. **Copy as CSV**
copies the list for a spreadsheet. The page says when the Match 13 numbers
are from, and if Match 13 couldn't be reached it keeps using the saved copy.

| In `data.ts` | Does |
|:--|:--|
| `picklistParts()` | What a team is scored on: Match 13 auto, teleop and endgame xP, our average points (APS), then each counter in `season.ts` |
| `rankTeams(teams, weights)` | Ranks teams best first, with a score from 0 to 100 |
| `picklistCsv(ranked, parts)` | The list as CSV, for a spreadsheet |
| `weightsStore` | How much each part counts (0 to 5), saved on this phone |
| `setWeight(key, n)`, `resetWeights()` | Change a weight (kept between 0 and 5), or put them all back to 1 |
| `picklistTeams(ratings, entries, pitEntries)` | Each team's numbers for `rankTeams()`: Match 13's `xAuto`, `xTele` and `xEnd`, and our averages from `teamSummary()`, so the team page and the picklist never disagree |
| `useRankedPicklist()` | For the page: the ranked list with this phone's weights, the weights, and `useRatings()` |

For each part, the best team gets 1 and the worst 0. A counter with
`lowerIsBetter` in `season.ts` (fuel missed) counts the other way. A team's
score is the weighted average of its parts. A number we don't have yet (no
scouting, or not rated by Match 13) is left out of that team's average
rather than counted as 0. Equal scores go in team number order.

## Where to start

1. Create `season.ts` with this season's counters and endgame choices.
2. Add an `Entry` type, `saveEntry()` and tests to `data.ts`.
3. Build the form for one robot, drawing its fields from `season.ts`.

Copy the pattern from the [Example module](../example/README.md): a table
and rules in `data.ts`, tests in `data.test.ts`, and the page calling
`data.ts`. Each table also needs a migration in `supabase/migrations/` that
makes it in the team database, with its permission rules and tests; see
[Adding a module](../../../docs/adding-a-module.md). Keep each pull request to
one step.

**Works with:** Robot status (can show entries waiting to sync).
