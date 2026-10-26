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
- `data.ts`: replace the notes with your module's data. Give the store a new
  key (the first argument to `createStore`).
- `data.test.ts`: replace the tests with tests for your functions.
- `README.md`: say what the module does.

## 3. Register it

Add one import and one entry to `src/modules/index.ts`:

```ts
import { pitMap } from './pit-map'

export const modules: ModuleDefinition[] = [inventory, training, bom, scouting, status, pitMap, example]
```

This file is shared, so this line is the one change outside your folder.
It needs a mentor's approval.

## 4. Check it

```
npm run check
```

The module tests in `src/modules/modules.test.tsx` check your module
automatically: a unique id, a name, a purpose, and a page that draws without
crashing.

## The pattern to follow

| File | Job |
|:--|:--|
| `index.ts` | Tells the app about the module. Optional `summary()` puts a status on the home page tile; optional `attention()` adds lines to "Needs attention". |
| `data.ts` | All the data and rules. Pages never save anything themselves. When the team database arrives, this is the only file that changes. |
| `data.test.ts` | Tests for every function in `data.ts`. |
| `SomethingPage.tsx` | The page. Reads data with a `use...()` hook and changes it with functions from `data.ts`. |

**Roles.** `useSession()` gives the current role. `isMentor(role)` is true
for mentors and admins. To limit a whole module to some roles, set `roles`
in `index.ts`, for example `roles: ['mentor', 'admin']`.

**Reading another module's data.** Import from that module's `data.ts`, never
from its pages. The BOM will read stock levels from `../inventory/data`.
