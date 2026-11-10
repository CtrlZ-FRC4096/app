# Scouting

**Partly built.** Match scouting for events. It has to work with no Wi-Fi: entries save on the device and sync when there is a connection.

## What works so far

- The match form, drawn from `season.ts`: counters, role (choose any), broke down, E-stop or A-stop, driver skill, endgame and notes
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
- A Match / Pit / Schedule / Rankings switch at the top of the page. The choice is in the address: `#/scouting` is the match form, `#/scouting/pit` the pit form and `#/scouting/schedule` the schedule. Each form is one panel, with a line between its sections (`FormSection.tsx`). The pit form (`PitForm.tsx`) asks for the team, drivetrain, weight and size, motors, preferred auto and strategy. Its choice lists are `DRIVETRAINS` and `AUTO_SIDES` in `season.ts`. Save pit entry: `savePitEntry()` in `data.ts` keeps it on this device (`pitStore`). It needs a team number; the match number is optional. Pit entries are sent to the team database the same way as match entries (#35): `syncEntries()` sends both, to the `scouting_pit_entries` table (`supabase/migrations/..._scouting_pit_entries.sql`, rules tested in `supabase/tests/scouting-pit-entries.test.ts`). Every visit to a team is kept. Both forms show what's saved on this device, Waiting or Synced, with `SavedOnDevice.tsx`.
- A team page (#36, `TeamPage.tsx`), at `#/scouting/team/9991`: everything scouted about one team at this event (`EVENT_KEY`). Type a team number, tap a team from the list of scouted teams, or tap "Team 9991" in the list of saved entries or on the Rankings page. It shows:
  - **Rank** (#39, `TeamRank.tsx`), at the top: the team's place in the event rankings and its record, like "Rank 3 of 42 · 5-1-0"
  - **Numbers**: each counter in `season.ts`, its average per match and each match's count
  - **How often**: bars for endgame, role, driver skill, E-stop or A-stop, and drivetrain (from the pit form), and how often it broke down
  - **Written answers**: match notes and pit answers, newest first, with who wrote them
  - **Match 13** (#37, `TeamRatings.tsx`): the team's xP rank at the event ("Rank 3 of 42"), its xP and how much it changed since the event started, the Auto / Teleop / Endgame parts, Statbotics' EPA and the win-loss-tie record, with when the numbers are from and a **Refresh** button. It reads the saved copy from `useRatings()` (see "One team's numbers" below), so with no connection it shows the saved numbers and says so. A team Match 13 hasn't rated shows "No Match 13 rating yet", and a part Match 13 left out shows "not given".

  The sums are `teamSummary()` in `data.ts`, a plain function so the picklist can use the same numbers. Adding a counter to `season.ts` adds it to the page with no other change. It counts this event's match and pit entries from the team database plus this phone's Waiting ones; two scouts watching the same robot count as two entries. `pitAnswers()` and `pitDrivetrain()` are the only code that reads a pit entry's answers. Each panel is its own component, so new ones (like Match 13's numbers or match videos) go below the others.
- The Competition menu lists Match, Pit, Schedule, Rankings and Teams under Scouting (`pages` in `index.ts`).
- Match videos (#41): `useTeamQualVideos(team)` in `data.ts` gives a team's qualification matches in order, each with its alliance, Won / Lost / Tied (or not played yet), the scores, and a YouTube link for each video. A played match with no links has no video on The Blue Alliance yet. It loads when the page opens, and `reload()` is for a "Check again" button. The **Match videos** panel on the team page (`TeamVideos.tsx`) shows one line per qual, like "Qual 12 · Red · Won 84–71", with a **Watch ↗** button that opens the video in YouTube in a new tab ("Watch (2) ↗" for a second video), "No video yet", or "Not played yet". It's only links, no video players or thumbnails, to keep the page light on venue Wi-Fi. `VideoList` draws the lines from rows, so tests can use made-up ones.
- Prescouting is its own module, just above Scouting in the Competition menu: see [its README](../prescouting/README.md). It gets the teams and EPA from `getEventTeams()` and `getRatings()` here.

Entries are kept on the device in a store (`entryStore` in `data.ts`), not a table from `createTable()`, because a table needs a connection on the live site. `syncEntries()` sends the Waiting ones to the `scouting_entries` table (`supabase/migrations/..._scouting_entries.sql`, rules tested in `supabase/tests/scouting-entries.test.ts`) and marks them Synced.

Each entry keeps the id its phone gave it, and the table skips an id it already has (`insertOnce()` in `src/core/table.ts`), so an entry sent twice is never saved twice. Everyone on the team can read every entry; only mentors change or delete them.

Don't raise `entryStore`'s version while entries are waiting on phones: entries saved under the old version would be ignored.

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
`EVENT_KEY` in `season.ts`: change it before each event. In demo mode they
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

If a load doesn't work, the last copy stays and `error` says why. Match 13
having nothing for the event yet isn't an error: nobody's rated yet. A copy
saved for another event counts as nothing saved. "Reset example data" may
clear the copy; that's fine, it loads again.
- Scouting data is visible to signed-in team members only.

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
