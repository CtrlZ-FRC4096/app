/**
 * Send the team's Slack reminders (src/modules/reminders.ts).
 *
 * Runs in GitHub Actions every afternoon (.github/workflows/slack-reminders.yml).
 * It reads the tables the reminders due today need, read-only, works out
 * their messages with planReminders() (src/core/reminders.ts), and the
 * team's Slack bot sends them.
 *
 * The repo is public, so its Actions logs are too: this only logs how many
 * messages each reminder sent, never what they said or who they went to.
 *
 * Needs, from the "database" environment:
 *   SUPABASE_DB_URL   the database connection string (secret)
 *   SLACK_BOT_TOKEN   the Slack bot token, xoxb-... (secret)
 * And from the workflow:
 *   REMINDERS_SEND    "true" to send; anything else only counts the messages
 *   SLACK_TEST_TO     optional: a Slack user (U…) or channel (C…) ID to send one test message to, instead of the reminders
 *
 * Build and run: npx vite build --ssr scripts/slack-reminders.ts --outDir .reminders && node .reminders/slack-reminders.js
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSlack } from '../supabase/functions/_shared/slack.ts'
import { planReminders, tablesFor, tablesQuery, todayInChicago, type Tables } from '../src/core/reminders'
import { REMINDERS } from '../src/modules/reminders'

const env = (name: string) => process.env[name]?.trim() ?? ''
const dbUrl = env('SUPABASE_DB_URL')
const token = env('SLACK_BOT_TOKEN')
const send = env('REMINDERS_SEND') === 'true'
const testTo = env('SLACK_TEST_TO')
// Only for testing against a fake Slack.
const slack = createSlack(token, { api: env('SLACK_API_URL') || undefined })

/** Run SQL and return psql's plain output. */
function psql(script: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'reminders-'))
  try {
    const file = join(dir, 'run.sql')
    writeFileSync(file, script)
    return execFileSync('psql', [dbUrl, '--no-psqlrc', '--quiet', '--tuples-only', '--no-align', '--set', 'ON_ERROR_STOP=1', '--file', file], { encoding: 'utf8' }).trim()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

async function main() {
  if (!token || !dbUrl) {
    console.log('::notice::Slack reminders are not set up yet (SLACK_BOT_TOKEN, SUPABASE_DB_URL). See supabase/README.md.')
    return
  }

  if (testTo) {
    const answer = await slack.send({ to: testTo, text: "A test message from the team app's Slack reminders. They can reach you." })
    if (!answer.ok) throw new Error(answer.error)
    console.log('Sent the test message.')
    return
  }

  const today = todayInChicago()
  const due = REMINDERS.filter((reminder) => reminder.days.includes(today.day))
  if (due.length === 0) {
    console.log(`No reminders go out on ${today.day} (${REMINDERS.length} switched on in all).`)
    return
  }

  const tables = JSON.parse(psql(tablesQuery(tablesFor(due)))) as Tables
  let problems = 0
  for (const run of planReminders(due, tables, today)) {
    const failed: string[] = [...run.problems]
    let sent = 0
    if (send) {
      for (const message of run.messages) {
        const answer = await slack.send(message)
        if (answer.ok) sent += 1
        else failed.push(answer.error)
      }
      console.log(`${run.name}: sent ${sent} of ${run.messages.length} messages.`)
    } else {
      console.log(`${run.name}: would send ${run.messages.length} messages (not sent: tick "Really send" to send them).`)
    }
    for (const problem of new Set(failed)) console.log(`::warning::${run.name}: ${problem}`)
    problems += failed.length
  }
  if (problems > 0) process.exitCode = 1
}

main().catch((error: Error) => {
  console.error(`::error::${error.message}`)
  process.exit(1)
})
