# Adding a module

A module is a folder in `src/modules/`. The app finds it through
`src/modules/index.ts`, and the home page and the navigation build
themselves from that list.

## 1. Copy the example

Copy `src/modules/example/` to a new folder named after your module, in
lowercase with dashes, for example `src/modules/pit-map/`.

The id becomes the address: `app.team4096.org/#/pit-map`.

## 2. Rename things

In your new folder:

- `index.ts`: change `example` to your module's name, and set `id`, `name`
  and `purpose`. Point `load` at your page file.
- Rename `ExamplePage.tsx` to match, such as `PitMapPage.tsx`.
- `data.ts`: replace the notes with your module's data. Give the table a
  new name that starts with your module's, such as `pit_map_spots` (the
  first argument to `createTable`).
- `data.test.ts`: replace the tests with tests for your functions.
- `README.md`: say what the module does.

## 3. Add its table to the database

Each table in `data.ts` needs a matching table in the team database, made
by a migration with its permission rules. Follow
[Adding a table](../supabase/README.md#adding-a-table): copy the example's
migration and its tests in `supabase/`, and change them for your table.

`npm test` runs your migration and its tests on your computer, and checks
that your example rows fit the table. A mentor reviews everything in
`supabase/` before it's merged; when it is, the database gets the new table
automatically.

## 4. Register it

Add one import and one entry to `src/modules/index.ts`:

```ts
import { pitMap } from './pit-map'

export const modules: ModuleDefinition[] = [inventory, training, bom, scouting, status, pitMap, example, members]
```

This file is shared, so this line needs a mentor's approval.

## 5. Check it

```
npm run check
```

The module tests in `src/modules/modules.test.tsx` check your module
automatically: a unique id, a name, a purpose, and a page that draws for
every role that can open it.

## The pattern to follow

| File | Job |
|:--|:--|
| `index.ts` | Tells the app about the module. Optional `useSummary` puts a status on the home page tile; optional `useAttention` adds lines to "Needs attention". Both are hooks from `data.ts`. |
| `data.ts` | The module's table (`createTable`), its rules, and the functions that change it. Pages never save anything themselves. |
| `data.test.ts` | Tests for every function in `data.ts`. They run in demo mode. |
| `SomethingPage.tsx` | The page. Reads rows with a `use...()` hook and changes them with functions from `data.ts`. |
| `supabase/migrations/..._your_table.sql` | Makes the table in the team database, with its permission rules. |
| `supabase/tests/your-table.test.ts` | Tests for the permission rules: who can and can't read, add, change and delete. |

**Tables.** `createTable('pit_map_spots', { demo: [...] })` gives you
`useRows()` for pages, `rows()` for `data.ts`, and `insert`, `update` and
`remove`. On your computer it uses your example rows; on the team site it
uses the database, and changes from other people show up by themselves.
Every row has `id` and `created_at`, and usually `created_by`, which the
database fills in.

**Functions that can fail** return `{ ok: true, value }` or
`{ ok: false, error }`, with the error written for the person using the app.
`insert`, `update` and `remove` already work this way, so `data.ts` can check
its own rules first and then return what they return.

**Roles.** `useSession()` gives the signed-in person's `id`, `name` and
`role`. `isMentor(role)` is true for mentors and admins. To limit a whole
module to some roles, set `roles` in `index.ts`, for example
`roles: ['mentor', 'admin']`. Hiding a button only keeps the page tidy: the
database's permission rules are what stop people.

**Showing who did something.** `useMemberNames()` from `src/core/members.ts`
turns a `created_by` id into a name.

**Reading another module's data.** Import from that module's `data.ts`, never
from its pages. The BOM will read stock levels from `../inventory/data`.
