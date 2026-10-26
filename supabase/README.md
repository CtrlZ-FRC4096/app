# The team database

The app's data lives in a Supabase project: a Postgres database with
permission rules on every table, and Sign in with Slack limited to the
Ctrl-Z workspace. This folder holds everything about it that belongs in the
repo. Changes here need a mentor's approval (see `.github/CODEOWNERS`).

| Where | What |
|:--|:--|
| `migrations/` | The SQL that builds the database, one file per change, run in name order |
| `tests/` | Tests for the permission rules, run by `npm test` on every pull request |

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

## Looking after it

- **Someone leaves the team:** Members > **Switch off**. They lose access
  straight away, even if they're still in Slack.
- **Staying awake:** the free plan pauses a project after a week without
  use. The "Keep the database awake" workflow prevents that by asking it a
  small question twice a week. GitHub stops scheduled workflows in a repo
  with no activity for 60 days; if that happens, run it once by hand from
  the Actions tab.
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
