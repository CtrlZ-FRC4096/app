/**
 * Pull attendance from the Slack channel into the team database.
 *
 * Runs in GitHub Actions every night (.github/workflows/attendance-sync.yml).
 * It reads the attendance channel and the member list with the Slack bot,
 * builds a payload (src/modules/attendance/sync.ts) and hands it to the
 * database function private.import_attendance, which adds only what's new.
 *
 * Needs, from the "database" environment and repo variables:
 *   SUPABASE_DB_URL        the database connection string (secret)
 *   SLACK_BOT_TOKEN        the Slack bot token, xoxb-... (secret)
 *   ATTENDANCE_CHANNEL_ID  the channel's ID, C... (variable)
 *   ATTENDANCE_SINCE       optional: the first day to pull, like 2026-01-01
 *
 * Build and run: npx vite build --ssr scripts/attendance-sync.ts --outDir .sync && node .sync/attendance-sync.js
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseUsers } from '../src/modules/attendance/slack-export'
import { pullFrom, syncPayload } from '../src/modules/attendance/sync'

const env = (name: string) => process.env[name]?.trim() ?? ''
const token = env('SLACK_BOT_TOKEN')
const channel = env('ATTENDANCE_CHANNEL_ID')
const dbUrl = env('SUPABASE_DB_URL')
const since = env('ATTENDANCE_SINCE') || null
// Only for testing against a fake Slack.
const slackApi = env('SLACK_API_URL') || 'https://slack.com/api'

type SlackResponse = Record<string, unknown> & { ok: boolean; error?: string; needed?: string; response_metadata?: { next_cursor?: string } }

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms))

async function slack(method: string, params: Record<string, string>): Promise<SlackResponse> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const response = await fetch(`${slackApi}/${method}?${new URLSearchParams(params)}`, { headers: { Authorization: `Bearer ${token}` } })
    if (response.status === 429) {
      // Slack says to slow down; wait as long as it asks.
      await sleep((Number(response.headers.get('retry-after')) || 30) * 1000)
      continue
    }
    const body = (await response.json()) as SlackResponse
    if (!body.ok) {
      const hint =
        body.error === 'not_in_channel' ? ' Invite the app to the channel: /invite @Ctrl-Z Team App' :
        body.error === 'missing_scope' ? ` The Slack app needs the ${body.needed} permission (OAuth & Permissions), then reinstall it.` :
        body.error === 'channel_not_found' ? ' Check ATTENDANCE_CHANNEL_ID, and that the app is in the channel.' : ''
      throw new Error(`Slack ${method} failed: ${body.error}.${hint}`)
    }
    return body
  }
  throw new Error(`Slack ${method} kept asking to slow down. Try again later.`)
}

/** Every page of a Slack list. */
async function everyPage(method: string, params: Record<string, string>, field: string): Promise<unknown[]> {
  const all: unknown[] = []
  let cursor = ''
  do {
    const body = await slack(method, { ...params, limit: '200', ...(cursor ? { cursor } : {}) })
    all.push(...((body[field] as unknown[]) ?? []))
    cursor = body.response_metadata?.next_cursor ?? ''
  } while (cursor)
  return all
}

/** Run SQL as the database owner and return psql's plain output. */
function psql(script: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'attendance-'))
  try {
    const file = join(dir, 'run.sql')
    writeFileSync(file, script)
    return execFileSync('psql', [dbUrl, '--no-psqlrc', '--tuples-only', '--no-align', '--set', 'ON_ERROR_STOP=1', '--file', file], { encoding: 'utf8' }).trim()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

async function main() {
  if (!token || !channel || !dbUrl) {
    console.log('::notice::Automatic attendance pulls are not set up yet (SLACK_BOT_TOKEN, ATTENDANCE_CHANNEL_ID, SUPABASE_DB_URL). See src/modules/attendance/README.md.')
    return
  }

  const newest = psql('select max(newest_message_at) from public.attendance_syncs;') || null
  const oldest = pullFrom(newest, since)
  console.log(`Reading the channel from ${oldest.toISOString()}`)

  const users = parseUsers(await everyPage('users.list', {}, 'members'))
  const messages = await everyPage('conversations.history', { channel, oldest: String(oldest.getTime() / 1000), inclusive: 'true' }, 'messages')
  const payload = syncPayload(users, messages)
  console.log(`${messages.length} messages: ${payload.checks.length} check-ins and check-outs, ${payload.rsvps.length} poll answers`)

  // psql reads the payload from a file, so its size doesn't matter, and quotes it safely with :'payload'.
  const dir = mkdtempSync(join(tmpdir(), 'attendance-'))
  try {
    const file = join(dir, 'payload.json')
    writeFileSync(file, JSON.stringify(payload))
    const result = psql(`\\set payload \`cat '${file}'\`\nselect row_to_json(s) from private.import_attendance(:'payload'::jsonb) s;\n`)
    const pulled = JSON.parse(result) as { people_added: number; checks_added: number; rsvps_changed: number }
    console.log(`Added ${pulled.checks_added} check-ins and check-outs, ${pulled.rsvps_changed} new or changed poll answers, ${pulled.people_added} new people.`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

main().catch((error: Error) => {
  console.error(`::error::${error.message}`)
  process.exit(1)
})
