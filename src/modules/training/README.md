# Training

The lessons live in the wiki. This keeps track of who has done them, and
lets mentors sign off hands-on skills.

## What works

- **The lessons.** The page has a section for each course in `COURSES`
  (`data.ts`), with its lessons in the order to do them. Each lesson's title
  links to its page on the wiki, in a new tab.
- **Mark done.** A big **Mark done** button on each lesson. Once it's done,
  the lesson says **Done ✓** with an **Undo** button. Anyone signed in can
  mark their own lessons; nobody can mark anyone else's. If saving fails,
  the page says why.
- **Progress.** At the top, "3 of 5 done" with a progress bar, and each
  course says how many of its lessons are done. They update as soon as you
  press a button.
- **The home page tile:** "2 of 5 lessons done", green once every lesson is
  done.
- **Hands-on skills.** Tools a mentor has to watch you use before you use
  them on your own (`SKILLS` in `data.ts`). Each shows **Ask for a
  sign-off**, **Waiting for a mentor** (with **Cancel**), or **Signed off by
  Pat Chen, Nov 12**.

Mentors and admins also see:

- **Waiting for sign-off**, at the top: each request's person, skill and how
  long it's waited, oldest first, with **Sign off** and **Not yet** (which
  deletes the request, so they can ask again later). Below it, **Sign people
  off without a request**: pick a skill and the people, such as everyone at
  a shop safety session. People are name tags: type in **Find someone** or
  tap a name to add them, and tap a tag to take them off (`PeoplePicker`
  in `src/core/ui.tsx`, the same picker as the Pit checklist). The home page's "Needs attention" says "2 sign-offs
  waiting."
- **Everyone's progress**, at the bottom: every student and student leader
  whose access is on, least done first so whoever needs a nudge is on top,
  with "3 of 5" and their count for each course and for skills. People with
  nothing done yet are listed too, as 0. **Find someone** searches by name.
  Tap a person to see which lessons they've done and their skills, with
  **Take back** on any sign-off made by mistake.

Try it in demo mode: View as Student is Alex, who is signed off on shop
safety and waiting for the drill press. View as Mentor to sign people off.

To add a lesson, add it to its course in `COURSES` at the top of `data.ts`
(the comment there says how). Never change a lesson's id: progress is saved
under it. Skills are the same: add one to `SKILLS` with a new id, and never
change an id. A mentor decides the list of skills. Neither needs a database
change.

## Files

| File | What it does |
|:--|:--|
| `data.ts` | The lessons, the skills, both tables, and every rule. |
| `data.test.ts` | Tests for `data.ts`. |
| `TrainingPage.tsx` | The page: your progress and the lessons, with the sections below. |
| `Skills.tsx` | Your hands-on skills: ask for a sign-off, or cancel. |
| `SignOffRequests.tsx` | Mentors: the requests waiting, and signing people off. |
| `EveryonesProgress.tsx` | Mentors: everyone's lessons and skills. |
| `training.css` | Layout for those three sections, using the app's colours. |

## The tables

- `training_progress` (`supabase/migrations/..._training_progress.sql`): one
  row for each lesson a person has finished. Marking a lesson not done
  deletes the row. People add and remove only their own rows. Everyone sees
  their own progress, and mentors and admins see everyone's.
- `training_signoffs` (`supabase/migrations/..._training_signoffs.sql` and
  `..._training_signoffs_mentors.sql`): one row per person per skill, either
  `requested` or `signed_off`. Who can do what:

  | | Students and student leaders | Mentors and admins |
  |:--|:--|:--|
  | See sign-offs | Their own | Everyone's |
  | Ask for a sign-off, for themselves | Yes | Yes |
  | Cancel their own request while it's waiting | Yes | Yes |
  | Sign anyone off, with or without a request | **No** | Yes |
  | Turn down a request, or take back a sign-off | **No** | Yes |

  The database fills in who signed off and when (`signed_off_by`,
  `signed_off_at`), so neither can be faked.

Hiding buttons on the page only keeps it tidy: these rules are what keep the
data safe. Tests: `data.test.ts`, and the rules in
`supabase/tests/training-progress.test.ts` and
`supabase/tests/training-signoffs.test.ts`.

## Rules

- Only mentors and admins can sign off a skill.
- Link to the wiki for lesson content. Don't copy lessons into the app.

## Still to build

- A Slack message to mentors when someone asks for a sign-off
  (`src/core/slack.ts`).
- Robot status showing how many sign-offs are waiting.

Copy the pattern from the [Example module](../example/README.md): a table
and rules in `data.ts`, tests in `data.test.ts`, and the page calling
`data.ts`. Each table also needs a migration in `supabase/migrations/` that
makes it in the team database, with its permission rules and tests; see
[Adding a module](../../../docs/adding-a-module.md). Keep each pull request to
one step.

**Works with:** Robot status (can show how many sign-offs are waiting).
