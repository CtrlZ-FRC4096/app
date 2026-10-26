# How to contribute

You don't need to have built a website before. If you get stuck on any step,
ask in Slack, and paste the exact error message.

## One-time setup

1. Install **[Node.js 22 LTS](https://nodejs.org/)**, **[Git](https://git-scm.com/)** and **[VS Code](https://code.visualstudio.com/)**.
2. Accept your invitation to the CtrlZ-FRC4096 organization on GitHub. A mentor sends these.
3. Tell Git who you are (use the email on your GitHub account):
   ```
   git config --global user.name "Your Name"
   git config --global user.email "you@example.com"
   ```
4. Get the code and run it:
   ```
   git clone https://github.com/CtrlZ-FRC4096/app.git
   cd app
   npm install
   npm run dev
   ```
   Open the address it prints, usually http://localhost:5173. On your
   computer the app runs in **demo mode**, on made-up example data, with a
   "View as" switch instead of Slack sign-in. You don't need the team
   database to build a module.

**On Windows**, if PowerShell says "running scripts is disabled on this
system", switch the VS Code terminal to **Command Prompt** (the **+** menu in
the terminal panel), or run this once in PowerShell:
`Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`

## Every time you work on something

1. **Pick an issue** from the [issues list](https://github.com/CtrlZ-FRC4096/app/issues).
   Assign it to yourself so nobody else starts the same thing. Issues
   labelled `good first issue` are a good place to begin.

2. **Get the latest code and make a branch.** Name the branch after the
   module and the change:
   ```
   git switch main
   git pull
   git switch -c inventory-parts-table
   ```

3. **Make the change.** Stay inside your module's folder in `src/modules/`.
   Use the [Example module](src/modules/example/) as the pattern to follow.
   If your module needs a new table, it also needs a migration and tests in
   `supabase/`: see [Adding a module](docs/adding-a-module.md).

4. **Check it.** All four of these have to pass before a pull request can
   be merged, so run them yourself first:
   ```
   npm run check
   ```
   Then try it in the browser: at phone size (browser developer tools >
   device toolbar), and as both a Student and a Mentor ("View as" in the
   header).

5. **Commit and push:**
   ```
   git add -A
   git commit -m "Inventory: show the example parts in a table"
   git push -u origin inventory-parts-table
   ```

6. **Open a pull request.** GitHub shows a button for it after you push. Fill
   in the template, and write `Closes #12` (your issue's number) so the
   issue closes when it's merged.

7. **Review.** Someone reviews it, and CI runs the checks. Fix anything they
   ask for by committing and pushing to the same branch. Once it's approved
   and the checks are green, it gets merged, and the live site updates about
   two minutes later.

Keep pull requests small: one issue, one pull request. Small ones get
reviewed quickly; big ones sit.

## Building with Claude

Using Claude (or Claude Code) is encouraged. It reads `CLAUDE.md` in this
repo, which tells it the rules. To get good results:

- **Give it the issue.** Paste the issue text and say which module folder to work in.
- **Ask for a plan first.** "Explain what you'll change before you change it" catches wrong turns early.
- **Ask it to write tests** for anything in `data.ts`.
- **Run `npm run check` yourself**, and look at the result in the browser.
- **Read the changes before you commit** (`git diff`, or the Source Control panel in VS Code). If you can't explain a change to a reviewer, ask Claude to explain it to you first.

You are responsible for everything in your pull request, whoever wrote it.

## Rules

- **No secrets in the code.** No passwords, API keys or tokens, ever. The repo is public.
- **No real personal information** in example data. Make it up.
- **Stay in your module folder.** Changes to `src/core/`, `src/App.tsx`, `.github/` or `supabase/` need a mentor's approval.
- **Don't add npm packages** without asking a mentor first.
- **Use the shared components** in `src/core/ui.tsx` and the styles in `src/core/styles.css`, so the app looks like one thing.
- **Hiding a button is not security.** The database's permission rules (in `supabase/migrations/`) decide who can do what.

## Adding a whole new module

See [docs/adding-a-module.md](docs/adding-a-module.md).
