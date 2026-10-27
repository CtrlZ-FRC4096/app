# Example: team notes

A small, complete module that exists to be copied. It shows every part a
module needs, at the smallest size that still does something real.

| File | What it does |
|:--|:--|
| `index.ts` | Tells the app about the module: its id, name, page, and the summary shown on the home page. |
| `data.ts` | The data and the rules. Pages call these functions and never save anything themselves. |
| `data.test.ts` | Tests for `data.ts`. Run them with `npm test`. |
| `ExamplePage.tsx` | The page: a form, a list, a button only mentors see, and a button that sends you a Slack message. |
| `reminders.ts` | An example Slack reminder that goes out by itself every Monday (switched off). See `src/core/reminders.ts`. |
| `reminders.test.ts` | Tests for the reminder's messages. |

To start a new module from it, follow [docs/adding-a-module.md](../../../docs/adding-a-module.md).

## Using Slack

**Send me a Slack message** on the Example page shows how any module sends
Slack messages. The page calls `sendMeASlackMessage()` in `data.ts`, which
builds the text with `slackHello()` and calls `sendSlackToMe()` from
`src/core/slack.ts`. That calls the `slack` server function on Supabase, which
holds the bot's key, and the team's Slack bot messages you. In demo mode
nothing is sent.

- **Message yourself:** `sendSlackToMe(text)`. Anyone can.
- **Message people or a channel:** `sendSlack({ people, channel, text })`, with
  member IDs and a channel ID. Only mentors can, so use it for mentor buttons
  like "Remind now".
- **On a schedule:** write a reminder like `reminders.ts` here. It's switched
  on by listing it in `src/modules/reminders.ts`, which a mentor approves.
- **Writing the text:** Slack's formatting is `*bold*` and `_italic_`. Make
  links with `appLink('page', 'label')` or `slackLink(url, 'label')`, and put
  anything people typed through `slackEscape()`.
