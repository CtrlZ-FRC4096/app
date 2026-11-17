# Leaderboards

Two leaderboards for students, for the team app's GitHub repo (`CtrlZ-FRC4096/app`), under
the Software menu. Everyone can open it.

- **Most issues solved:** for each person, how many different issues their
  merged pull requests closed.
- **Most pull requests:** how many of each person's pull requests were merged.

People are shown by their GitHub username, which links to their merged pull
requests. People with the same count share a rank.

## What counts

- **Only merged pull requests.** One closed without merging doesn't count.
- **An issue is solved by whoever wrote the pull request that closes it.**
  The pull request's description has to use one of GitHub's closing words:
  `Closes #12`, `Fixes #12` or `Resolves #12` (also close, closed, fix,
  fixed, resolve, resolved). "Closing #12", "Part of #12" or just "#12" in
  the title don't close the issue on GitHub, so they don't count here either.
  The page tells people this.
- An issue counts once per person, even if several of their pull requests
  close it.
- Pull requests by bots are left out.
- **Mentors are left off both boards**, since the boards are for students.
  GitHub doesn't know who's a mentor, so their GitHub usernames are listed in
  `MENTOR_LOGINS` in `data.ts`. Add a new mentor's username there (capitals
  don't matter).

## Where the numbers come from

The repo is public, so `data.ts` asks GitHub's API for its closed pull
requests straight from the browser (`fetchMergedPulls()`). No key is
needed, so there's no server function and no table or migration.

GitHub answers only **60 requests an hour from one network** without a key,
and everyone at school shares one network. Each load uses 1 request per 100
pull requests (3 right now). So:

- The answer is saved on the device and used for 15 minutes
  (`FRESH_MINUTES`) before the page asks again. **Refresh** asks straight away.
- If GitHub says no, the page shows when to try again and keeps showing the
  last numbers it had.

If that limit becomes a problem, a mentor could move the request into a
server function with a GitHub key (5,000 requests an hour), called with
`callFunction()` like The Blue Alliance's `tba`. Only `fetchMergedPulls()`
would change.

It reads at most the newest 1,000 pull requests.

## Demo mode

Nothing is asked of GitHub. The page shows made-up pull requests by
`demo-alex`, `demo-jordan` and others (`DEMO_PULLS` in `data.ts`).
