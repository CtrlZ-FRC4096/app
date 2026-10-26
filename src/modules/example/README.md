# Example: team notes

A small, complete module that exists to be copied. It shows every part a
module needs, at the smallest size that still does something real.

| File | What it does |
|:--|:--|
| `index.ts` | Tells the app about the module: its id, name, page, and the summary shown on the home page. |
| `data.ts` | The data and the rules. Pages call these functions and never save anything themselves. |
| `data.test.ts` | Tests for `data.ts`. Run them with `npm test`. |
| `ExamplePage.tsx` | The page: a form, a list, and a button only mentors see. |

To start a new module from it, follow [docs/adding-a-module.md](../../../docs/adding-a-module.md).
