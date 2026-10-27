# The team database

The app's data lives in a Supabase project: a Postgres database with
permission rules on every table, and Sign in with Slack limited to the
Ctrl-Z workspace. This folder holds everything about it that belongs in the
repo. Changes here need a mentor's approval (see `.github/CODEOWNERS`).

| Where | What |
|:--|:--|
| `migrations/` | The SQL that builds the database, one file per change, run in name order |
| `functions/` | Server functions: code that runs on Supabase with secret keys, like The Blue Alliance's |
| `tests/` | Tests for the permission rules and server functions, run by `npm test` on every pull request |

## How it fits together

- **Demo mode and live mode.** On your computer, in the tests, and on the
  live site until the database is connected, the app runs in demo mode on
  made-up example data. Once the site is built with the database's address
  and publishable key, it runs in live mode: everyone signs in with Slack and
  shares the same data. A module's code is the same in both modes (see
  `src/core/table.ts`).
- **Sign-in.** Supabase handles Sign in with Slack. The first time someone
  signs in, a trigger in the members migration adds them to `members` as a
  student, but only if Slack says they came through the Ctrl-Z workspace.
  Anyone else is turned away before an account is made.
- **Roles.** `members.role` is student, mentor or admin. Admins change it in
  the app's Members module. Switching off someone's access (`active = false`)
  locks them out straight away.
- **Permission rules.** Every table has row level security on, and policies
  that say who can read and change what, using `private.is_member()`,
  `private.is_mentor()` and `private.is_admin()`. People who aren't signed in
  get nothing. These rules are the real security: the browser can send the
  database anything.
- **Migrations go out automatically.** When a pull request is merged, the
  Deploy workflow applies any new migrations to the database before it
  publishes the site.

## Adding a table

1. Copy `migrations/20261027000100_example_notes.sql`. Name the copy with the
   current date and time and what it does, such as
   `20261101180000_inventory_parts.sql`. Start the table's name with your
   module's name.
2. Change the columns, and write the rules: who can read, add, change and
   delete. Leave out any rule you don't need; no rule means nobody can.
3. Copy `tests/example-notes.test.ts` and write one test for each thing the
   rules should allow or stop. `npm test` runs them against a real Postgres
   on your computer, so nothing touches the team database.
4. In your module's `data.ts`, make the table with
   `createTable('your_table', { demo: [...] })`. The example rows need
   exactly the table's columns.

`tests/tables.test.ts` checks every table for you: row level security is on,
signed-out visitors get nothing, live updates are on, and the example rows
fit the table.

**Never edit a migration after it's merged.** The database has already run
it. To change a table, add a new migration that alters it.

**Merge order doesn't have to match name order.** If your branch's
migration is named before one that was merged while you were working, the
Deploy workflow still applies it. The tests run migrations in name order,
so they'll fail if yours needs a table from a migration named after it:
rename yours with the current date and time.

**Never put the secret key anywhere in this repo.** The site only ever uses
the publishable key, which is meant to be public.

## Setting it up (once, by a mentor)

This takes about 30 minutes. The site keeps working in demo mode until the
last step, so it can be done in any order up to there. Keep the Supabase
login and the database password in the coaches' Bitwarden.

### 1. Make the Supabase project

1. Sign in at [supabase.com](https://supabase.com) with an account the
   coaches share, so the project doesn't depend on one person.
2. Make an organization for the team on the **Free** plan, then a **New
   project** in it, named `ctrlz-app`, in the US region nearest to you.
3. Click **Generate a password**, and save it in Bitwarden. Use letters and
   numbers only, so it works in a connection address without changes.
4. Keep the default security options (the Data API on, using the public
   schema).

### 2. Make the Slack app

1. Go to [api.slack.com/apps](https://api.slack.com/apps), then **Create
   New App > From an app manifest**, and pick the Ctrl-Z workspace.
2. Paste this, replacing `YOUR-PROJECT-REF` with the part before
   `.supabase.co` in your project's URL (Supabase: **Project Settings >
   Data API**):

   ```yaml
   display_information:
     name: Ctrl-Z Team App
     description: Sign in to the Ctrl-Z team app
     background_color: "#0058a9"
   oauth_config:
     redirect_urls:
       - https://YOUR-PROJECT-REF.supabase.co/auth/v1/callback
     scopes:
       user:
         - openid
         - email
         - profile
   settings:
     org_deploy_enabled: false
     socket_mode_enabled: false
     token_rotation_enabled: false
   ```

3. Click **Create**. Under **Basic Information > App Credentials**, note
   the **Client ID** and **Client Secret** for the next step. The app
   doesn't need installing: people approve it the first time they sign in.
   If the workspace requires admin approval for apps, approve it in
   Slack's app management settings.

### 3. Turn on Slack sign-in in Supabase

1. **Authentication > Sign In / Providers**:
   - Open **Slack (OIDC)**, turn it on, paste the Client ID and Client
     Secret, and save.
   - Turn **Email** off. Keep **Allow new users to sign up** on (that's how
     new team members get in) and **Allow anonymous sign-ins** off.
2. **Authentication > URL Configuration**:
   - **Site URL:** `https://ctrlz-frc4096.github.io/app/`
   - **Redirect URLs:** add `https://ctrlz-frc4096.github.io/app/` and
     `http://localhost:5173/`. Add `https://app.team4096.org/` when that
     address is set up.

### 4. Let GitHub update the database

1. In Supabase, click **Connect** (top of the project page) and copy the
   **Session pooler** connection string. (The direct one doesn't work from
   GitHub.) Put the database password in place of `[YOUR-PASSWORD]`.
2. In the GitHub repo: **Settings > Environments > New environment**, named
   `database`.
   - **Deployment branches and tags:** choose **Selected branches and
     tags** and add `main`. This is what stops a pull request from reading
     the password, so don't skip it.
   - **Environment secrets > Add secret:** name `SUPABASE_DB_URL`, value
     the connection string.
3. **Actions > Deploy > Run workflow** (on `main`). The "database" job
   applies the migrations. In Supabase's **Table Editor** you should now see
   `members` and `example_notes`.

### 5. Tell the database which Slack workspace to let in

1. Open Slack in a web browser. The address looks like
   `https://app.slack.com/client/T0123ABCD/...`; the part starting with
   **T** is the workspace ID.
2. In Supabase's **SQL Editor**, run (with your ID):

   ```sql
   insert into private.settings (key, value) values ('slack_team_id', 'T0123ABCD');
   ```

Until this is set, the database turns everyone away.

### 6. Switch the site to live mode

1. In the GitHub repo: **Settings > Secrets and variables > Actions >
   Variables > New repository variable**. Add two:
   - `SUPABASE_URL`: the Project URL, like `https://YOUR-PROJECT-REF.supabase.co`
   - `SUPABASE_PUBLISHABLE_KEY`: from **Project Settings > API Keys**, the
     key starting `sb_publishable_`. Never the secret key.

   These are variables, not secrets, because both are meant to be public.
2. **Actions > Deploy > Run workflow.** When it finishes, the site asks
   everyone to sign in with Slack.

### 7. Make yourself an admin

1. Open the site and sign in with Slack. You'll start as a student.
2. In Supabase's **SQL Editor**, run (with your Slack email):

   ```sql
   update public.members set role = 'admin'
   where id = (select id from auth.users where email = 'you@example.com');
   ```

3. Reload the site. The **Members** module appears: make other mentors
   mentors or admins from there.

## Server functions

Anything that needs a secret key (The Blue Alliance, Onshape, a Slack bot)
can't run in the browser or live in this public repo. It runs in a
**server function** instead: a small TypeScript program in
`supabase/functions/<name>/index.ts` that runs on Supabase's servers
(Supabase calls them Edge Functions). Keys are Supabase secrets that only
the functions can read.

| Function | What it does |
|:--|:--|
| `hello` | The example to copy. Answers members with their name and which secrets are set |
| `tba` | The Blue Alliance for scouting: an event's schedule and rankings, and a team's matches and name |
| `onshape` | Onshape for the BOM: a system's parts from its assembly (sub-assemblies flattened) or Part Studio |
| `slack` | Slack messages from the team's bot: to yourself (anyone), or to people and a channel (mentors). Used through `src/core/slack.ts` |
| `calendar` | The team's Google Calendar: everyone sees its events; mentors add events, and change or remove the ones the app added. Used through `src/core/calendar.ts` |

Slack reminders that go out by themselves on a schedule don't use a server
function: see [Slack reminders on a schedule](#slack-reminders-on-a-schedule).

How they fit together:

- **Only team members can call them.** Supabase checks the caller is
  signed in, then `forMembers()` in `functions/_shared/members.ts` looks
  them up in `members` with their own sign-in, so the database's rules
  decide. People whose access is off are turned away.
- **The app calls them from a module's `data.ts`** with `callFunction()`
  from `src/core/functions.ts`. In demo mode it returns the example data
  you give it instead, so students can build without keys.
- **Merging deploys them.** The Deploy workflow deploys every folder in
  `functions/` (except `_shared`) after applying migrations.
- **The Members page checks them.** Mentors click **Check them** under
  **Server functions** to see if they're deployed and the keys work.

### Setting them up (once, by a mentor)

Every key, and where it goes. Supabase's are under **Edge Functions >
Secrets**; GitHub's under **Settings > Environments > database**. Never
paste a key anywhere else, including chat.

| Key | Name | Where |
|:--|:--|:--|
| Supabase access token | `SUPABASE_ACCESS_TOKEN` | GitHub |
| The Blue Alliance read key | `TBA_KEY` | Supabase |
| Onshape access key and secret key | `ONSHAPE_ACCESS_KEY`, `ONSHAPE_SECRET_KEY` | Supabase |
| Slack bot token (`xoxb-...`) | `SLACK_BOT_TOKEN` | Supabase **and** GitHub (the attendance pull and reminders use GitHub's) |
| Google service account key (a JSON file) | `GOOGLE_SERVICE_ACCOUNT_KEY` | Supabase |
| The team calendar's ID | `GOOGLE_CALENDAR_ID` | Supabase |

1. **Let GitHub deploy functions.** Sign in to
   [supabase.com](https://supabase.com) with the coaches' shared account,
   open **Account > Access Tokens**, and **Generate new token** named
   `GitHub deploy`. In the GitHub repo, **Settings > Environments >
   database > Add environment secret**: name `SUPABASE_ACCESS_TOKEN`, value
   the token. Don't paste it anywhere else: it can change every project the
   account owns.
2. **Add The Blue Alliance's key.** Sign in at
   [thebluealliance.com/account](https://www.thebluealliance.com/account),
   and under **Read API Keys** add one described as `Ctrl-Z team app`. In
   Supabase, open **Edge Functions > Secrets** and add `TBA_KEY` with the
   key, then **Save**. (Or, with the Supabase CLI:
   `supabase secrets set TBA_KEY=... --project-ref <ref>`.)
3. **Add Onshape's keys.** The keys act as the Onshape user who makes
   them, with that user's access, so use a team or mentor account that the
   robot documents are shared with, not a student's.
   - Sign in at [cad.onshape.com](https://cad.onshape.com) with that
     account, and open the [Developer Portal's API keys](https://dev-portal.onshape.com/keys)
     (or **My Account > Developer > API keys**). Individual accounts can
     have 2 keys.
   - **Create new API key** with **Read your documents** and **Write to
     your documents** ticked. Importing only reads; writing part numbers
     into Onshape (#21) needs write. The app never deletes or shares, so
     leave those off.
   - Copy both the **access key** and the **secret key** before closing:
     Onshape never shows the secret again. Keep both in Bitwarden.
   - In Supabase's **Edge Functions > Secrets**, add `ONSHAPE_ACCESS_KEY`
     and `ONSHAPE_SECRET_KEY`.

   Onshape limits API calls per year, counted against that account. The
   app only calls Onshape when someone clicks **Import from Onshape** (two
   calls each time) or **Check them** (one).
4. **Let the Slack bot send messages.** This is the same Slack app people
   sign in with, and the same bot the attendance pull uses.
   - At [api.slack.com/apps](https://api.slack.com/apps), open **Ctrl-Z
     Team App > OAuth & Permissions > Bot Token Scopes** and make sure it
     has `chat:write` (sending messages), plus `channels:history` and
     `users:read` for the attendance pull. Add any that are missing, then
     click **Reinstall to Workspace** in the banner and approve.
   - **App Home > Show Tabs:** turn on **Messages Tab**, and untick
     **Allow users to send Slash commands and messages from the messages
     tab**. People then see the app's messages in Slack, and know not to
     reply to it.
   - Copy the **Bot User OAuth Token** (`xoxb-...`) from **OAuth &
     Permissions**, and add it in Supabase as `SLACK_BOT_TOKEN`. If it's
     different from the one in GitHub's `database` environment (it usually
     stays the same when you reinstall), update that one too.
   - To post in a channel, the app has to be in it: type
     `/invite @Ctrl-Z Team App` there.
5. **Connect the team's Google Calendar.** The app signs in to Google as a
   *service account*: a robot Google account that only sees what's shared
   with it.
   1. Sign in to [console.cloud.google.com](https://console.cloud.google.com)
      with a team or mentor Google account, and make a project (the project
      picker at the top > **New project**) named `ctrlz-team-app`.
   2. **APIs & Services > Library**: find **Google Calendar API** and click
      **Enable**.
   3. **IAM & Admin > Service Accounts > Create service account**, named
      `team-app`. Skip the optional steps: it needs no roles.
   4. Open it, then **Keys > Add key > Create new key > JSON**. A file
      downloads: that's the key. Keep it in Bitwarden and delete the
      download. (If Google says key creation is turned off, your Google
      organization's admin has to allow it for this project.)
   5. Copy the service account's email, like
      `team-app@ctrlz-team-app.iam.gserviceaccount.com`.
   6. In Google Calendar, open the team calendar's **Settings and
      sharing**. Under **Share with specific people or groups**, add that
      email with **Make changes to events**. (With **See all event
      details**, the app can show events but not add them.) Under
      **Integrate calendar**, copy the **Calendar ID**.
   7. In Supabase, add `GOOGLE_SERVICE_ACCOUNT_KEY`: open the JSON file in
      a text editor and paste all of it. Then add `GOOGLE_CALENDAR_ID`: the
      calendar ID.
6. **Deploy:** **Actions > Deploy > Run workflow** on `main`.
7. **Check:** in the app, **Members > Server functions > Check them**. Every
   line should say OK, and the Slack bot sends you a test message.

A new secret works straight away, with no redeploy. To change one, set it
again with the same name.

### Writing a new function

1. Copy `functions/hello/` to `functions/<name>/` and change what it does
   inside `forMembers(...)`. Answer with `reply({ ... })`, and with
   `reply({ error: 'What to do' }, 400)` when something's wrong: the app
   shows that `error` to the person.
2. **Only do what the app needs.** Like `tba`, accept a few named requests
   and check them, rather than passing on whatever the browser sends, so a
   key can't be used for anything else.
3. Put logic that doesn't need Deno (working things out, checking
   requests) in its own file with no `npm:` imports, and test it in
   `tests/` like `tests/functions.test.ts`. CI also runs `deno check` on
   every function.
4. In the module's `data.ts`, call it with
   `callFunction('<name>', body, () => exampleAnswer)`.
5. If it needs a new secret, add the name to `SECRETS` in
   `functions/hello/index.ts`, so **Check them** shows whether it's set, and
   write down here how to get the key.

Never log a secret, send one back to the browser, or commit one: keys for
trying functions on your own computer go in `functions/.env`, which Git
ignores.

### Slack reminders on a schedule

The **Send Slack reminders** workflow (`.github/workflows/slack-reminders.yml`)
runs every afternoon and sends the reminders listed in
`src/modules/reminders.ts`. How to write one is in `src/core/reminders.ts`,
with an example in `src/modules/example/reminders.ts`. It runs in GitHub
rather than Supabase, with the `database` environment's `SUPABASE_DB_URL`
and `SLACK_BOT_TOKEN`, and only reads the database.

- **Try it:** **Actions > Send Slack reminders > Run workflow**, with your
  Slack user ID in **test_to** (in Slack: your profile > **⋮** > **Copy
  member ID**). The bot messages you.
- **See what it would send:** **Run workflow** with **send** unticked counts
  today's messages without sending them.
- **The time:** change the `cron` line in the workflow. It's in UTC.
- The repo is public, so the run's log is too: it only says how many
  messages went, never what they said or who to.

## Looking after it

- **Someone leaves the team:** Members > **Switch off**. They lose access
  straight away, even if they're still in Slack.
- **Staying awake:** the free plan pauses a project after a week without
  use. The "Keep the database awake" workflow prevents that by asking it a
  small question twice a week. GitHub stops scheduled workflows in a repo
  with no activity for 60 days; if that happens, run it once by hand from
  the Actions tab.
- **Attendance from Slack:** the "Pull attendance from Slack" workflow
  reads the attendance channel every night once it has a Slack bot token. See
  [the Attendance README](../src/modules/attendance/README.md#pulling-from-slack-automatically).
- **Staying on the free plan.** The team's use fits, with room to spare, except
  for data sent to browsers (egress). Check **Organization > Usage** in
  Supabase once a month during build season; it shows each item against
  the plan. Going over doesn't cost money on the free plan, but if it keeps
  happening Supabase restricts the project until the next month.

  | Item | Free plan | The team |
  |:--|:--|:--|
  | Database size | 500 MB | A few MB. Attendance adds a few hundred rows a week |
  | Egress (data sent to browsers) | 5 GB a month | The one to watch: each visit loads whole tables, and the attendance tables grow all season. Estimated 1.5 GB a month in build season now, more by the end |
  | Monthly active users | 50,000 | About 100 |
  | Server function calls | 500,000 a month | Thousands. Live rankings at events (#39) will add the most |
  | Realtime connections at once | 200 | One per open tab |
  | Server functions | 100 | 5 |

  If egress gets close, the cheapest fixes are loading less of the
  attendance tables (only this season's rows, or only when the Attendance
  tab opens), or the Pro plan's 250 GB.
- **Backups:** the free plan has none. Before the team relies on the data,
  either upgrade to Pro ($25 a month, daily backups) or set up a scheduled
  backup.
- **Trying live mode on your computer (mentors):** make a file called
  `.env.local` in the repo folder (Git ignores it) with:

  ```
  VITE_SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co
  VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
  ```

  `npm run dev` then signs in with Slack and uses the real data, with your
  real permissions. The tests always run in demo mode.
