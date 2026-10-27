import { describe, expect, it } from 'vitest'
import { pullFrom, syncPayload } from './sync'
import type { SlackUser } from './slack-export'

const users: SlackUser[] = [
  { id: 'U0ALEX', name: 'Alex Rivera', deleted: false, bot: false },
  { id: 'U0DREW', name: 'Drew Morgan', deleted: false, bot: false },
]
const jibble = (name: string, action: string, ts: number) => ({
  bot_id: 'B043P2REYJZ',
  ts: String(ts),
  blocks: [{ type: 'rich_text', elements: [{ type: 'rich_text_section', elements: [{ type: 'text', text: `${name} ` }, { type: 'text', text: action }] }] }],
})
const poll = (ts: number, yes: string[], no: string[]) => ({
  bot_id: 'BPOLL',
  ts: String(ts),
  blocks: [
    { block_id: 'p-vote-0', text: { text: `:one: Yes\n${yes.map((id) => `<@${id}>`).join(', ')}` } },
    { block_id: 'p-vote-1', text: { text: `:two: No\n${no.map((id) => `<@${id}>`).join(', ')}` } },
  ],
})

describe('syncPayload', () => {
  // Jan 20, 2026, 6:05 PM Central is 1768953900.
  const messages = [
    jibble('Drew Morgan', 'jibbled out', 1768963200),
    jibble('Drew Morgan', 'jibbled in', 1768953900),
    jibble('Nobody Known', 'jibbled in', 1768954000),
    poll(1768921200, ['U0DREW'], ['U0ALEX']),
    { user: 'U0ALEX', text: 'see you tonight', ts: '1768964000.000100' },
  ]

  it('turns channel messages into people, check-ins and answers for the database', () => {
    const payload = syncPayload(users, messages)
    expect(payload.checks).toEqual([
      { slack_user_id: 'U0DREW', name: 'Drew Morgan', direction: 'out', at: '2026-01-21T02:40:00.000Z' },
      { slack_user_id: 'U0DREW', name: 'Drew Morgan', direction: 'in', at: '2026-01-21T00:05:00.000Z' },
      { slack_user_id: null, name: 'Nobody Known', direction: 'in', at: '2026-01-21T00:06:40.000Z' },
    ])
    expect(payload.rsvps).toEqual([
      { slack_user_id: 'U0DREW', day: '2026-01-20', coming: true },
      { slack_user_id: 'U0ALEX', day: '2026-01-20', coming: false },
    ])
    expect(payload.people).toContainEqual({ slack_user_id: null, name: 'Nobody Known' })
  })

  it('remembers the newest message read, including ordinary messages', () => {
    expect(syncPayload(users, messages).newest_message_at).toBe('2026-01-21T02:53:20.000Z')
    expect(syncPayload(users, []).newest_message_at).toBeNull()
  })
})

describe('pullFrom', () => {
  it('starts 3 days before the newest message already pulled, to catch late poll votes', () => {
    expect(pullFrom('2026-01-21T02:40:00Z', null).toISOString()).toBe('2026-01-18T02:40:00.000Z')
  })

  it('starts the first pull on ATTENDANCE_SINCE, or 180 days ago', () => {
    expect(pullFrom(null, '2026-01-01').toISOString()).toBe('2026-01-01T00:00:00.000Z')
    expect(pullFrom(null, null, new Date('2026-07-01T00:00:00Z')).toISOString()).toBe('2026-01-02T00:00:00.000Z')
  })
})
