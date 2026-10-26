# Ctrl-Z Team App

One app for everything Team 4096 tracks: inventory, the BOM, scouting, robot
status and training. Each of those is a **module**: a folder in
`src/modules/` that plugs into the same layout, roles and navigation.

**Live site:** https://ctrlz-frc4096.github.io/app/ (moving to https://app.team4096.org)

> **Work in progress.** The frame is built: Slack sign-in, roles, the team
> database and a working Example module. The other modules are waiting for
> students to build them. Until the database is connected, the live site
> runs in demo mode on example data, with a "View as" switch instead of
> sign-in. That's also how it always runs on your computer.

## Run it on your computer

You need [Node.js 22](https://nodejs.org/) and [Git](https://git-scm.com/).

```
git clone https://github.com/CtrlZ-FRC4096/app.git
cd app
npm install
npm run dev
```

Then open the address it prints (usually http://localhost:5173). The page
reloads by itself when you save a file.

## Contributing

Read **[CONTRIBUTING.md](CONTRIBUTING.md)**. It walks through picking a task,
making a branch, checking your work and opening a pull request.

To start a new module, follow **[docs/adding-a-module.md](docs/adding-a-module.md)**.

## Commands

| Command | What it does |
|:--|:--|
| `npm run dev` | Runs the app on your computer |
| `npm test` | Runs the tests |
| `npm run check` | Everything CI checks: lint, type check, tests and a build. Run it before you push. |

## How it's put together

| Where | What |
|:--|:--|
| `src/modules/` | One folder per module. **This is where most work happens.** |
| `src/modules/example/` | A small, complete module to copy |
| `src/modules/index.ts` | The list of modules. Add yours here. |
| `src/modules/members/` | Who's on the team and their roles, for mentors and admins |
| `src/core/` | Shared pieces: sign-in, roles, tables, layout, components. Changes need a mentor's approval. |
| `supabase/` | The team database: migrations, permission rules, their tests, and [how to set it up](supabase/README.md) |
| `docs/design.md` | Why the app is built this way |

The site is static files on GitHub Pages, published automatically when a
pull request is merged into `main`. The data lives in Supabase, whose
permission rules decide what each person can read and change. There is no
server of our own to look after.
