import { describe, expect, it } from 'vitest'
import { matchName, parseDay, parseExport, parseUsers, similarity } from './slack-export'

// Made-up messages in the shape Slack exports them.
const jibble = (name: string, action: string, ts: string) => ({
  type: 'message',
  bot_id: 'B043P2REYJZ',
  ts,
  blocks: [{ type: 'rich_text', elements: [{ type: 'rich_text_section', elements: [{ type: 'text', text: name + ' ' }, { type: 'text', text: action }] }] }],
})

const poll = (ts: string, yes: string[], no: string[]) => ({
  type: 'message',
  bot_id: 'BSIMPLEPOLL',
  ts,
  blocks: [
    { type: 'section', block_id: 'q1', text: { type: 'mrkdwn', text: '*Coming tonight?*' } },
    { type: 'section', block_id: 'p1-vote-0', text: { type: 'mrkdwn', text: `:one: Yes \`${yes.length}\`\n${yes.map((id) => `<@${id}>`).join(', ')}` } },
    { type: 'section', block_id: 'p1-vote-1', text: { type: 'mrkdwn', text: `:two: No \`${no.length}\`\n${no.map((id) => `<@${id}>`).join(', ')}` } },
  ],
})

const USERS = [
  { id: 'U0DEMO0001', name: 'alex', real_name: 'Alex Rivera', profile: { real_name: 'Alex Rivera', email: 'not-read@example.com' }, deleted: false },
  { id: 'U0DEMO0009', name: 'alex.old', profile: { real_name: 'Alex Rivera' }, deleted: true },
  { id: 'U0DEMO0004', name: 'jordan', profile: { real_name: 'Jordan Kim (2024)' }, deleted: false },
  { id: 'U0DEMO0005', name: 'sam', profile: { real_name: 'Samuel Ortiz' }, deleted: false },
  { id: 'B043P2REYJZ', name: 'jibble', profile: { real_name: 'jibble' }, is_bot: true },
]

describe('parseUsers', () => {
  it('reads IDs and real names, and marks bots and deactivated accounts', () => {
    const users = parseUsers(USERS)
    expect(users[0]).toEqual({ id: 'U0DEMO0001', name: 'Alex Rivera', deleted: false, bot: false })
    expect(users.find((u) => u.name === 'jibble')?.bot).toBe(true)
    expect(JSON.stringify(users)).not.toContain('example.com')
  })
})

describe('parseDay', () => {
  it('reads Jibble check-ins and check-outs with their times', () => {
    const day = parseDay([jibble('Alex Rivera', 'jibbled in', '1767917340.000100'), jibble('Alex Rivera', 'jibbled out', '1767924480.000200')])
    expect(day.checks).toEqual([
      { name: 'Alex Rivera', slackUserId: null, direction: 'in', at: '2026-01-09T00:09:00.000Z' },
      { name: 'Alex Rivera', slackUserId: null, direction: 'out', at: '2026-01-09T02:08:00.000Z' },
    ])
  })

  it('reads poll votes: option one is yes, any other option is no', () => {
    const day = parseDay([poll('1767880800.000000', ['U0DEMO0001', 'U0DEMO0004'], ['U0DEMO0005'])])
    expect(day.polls).toEqual([{ at: '2026-01-08T14:00:00.000Z', yes: ['U0DEMO0001', 'U0DEMO0004'], no: ['U0DEMO0005'] }])
  })

  it('ignores people typing "jibbled in" themselves, and other messages', () => {
    const day = parseDay([{ type: 'message', user: 'U0DEMO0001', text: 'I jibbled in', ts: '1767917340.0' }, { type: 'message', text: 'hi', ts: '1.0' }])
    expect(day).toEqual({ checks: [], polls: [] })
  })
})

describe('matchName', () => {
  const users = parseUsers(USERS)

  it('prefers the active account when two have the same name', () => {
    expect(matchName('Alex Rivera', users)).toEqual({ user: users[0], how: 'exact' })
  })

  it('matches on the first two words, like "Jordan Kim" for "Jordan Kim (2024)"', () => {
    expect(matchName('Jordan Kim', users)?.user.id).toBe('U0DEMO0004')
  })

  it('matches a close spelling, and says so', () => {
    expect(matchName('Samuel Ortis', users)).toMatchObject({ user: { id: 'U0DEMO0005' }, how: 'similar' })
  })

  it('matches nobody when no name is close', () => {
    expect(matchName('Zz Qq', users)).toBeNull()
  })

  it('never matches a bot', () => {
    expect(matchName('jibble', users)).toBeNull()
  })
})

describe('similarity', () => {
  it('works like Python difflib ratio', () => {
    expect(similarity('abcd', 'bcde')).toBeCloseTo(0.75)
    expect(similarity('same', 'same')).toBe(1)
  })
})

describe('parseExport', () => {
  it('finds users.json and each channel’s day files, and skips everything else', () => {
    const parsed = parseExport([
      { path: 'export/users.json', text: JSON.stringify(USERS) },
      { path: 'export/channels.json', text: '[]' },
      { path: 'export/attendance/2026-01-08.json', text: JSON.stringify([jibble('Alex Rivera', 'jibbled in', '1767917340')]) },
      { path: 'export/general/2026-01-08.json', text: '[]' },
      { path: 'export/attendance/2026-01-09.json', text: 'not json' },
    ])
    expect(parsed.users).toHaveLength(5)
    expect(parsed.channels).toEqual(['attendance', 'general'])
    expect(parsed.daysByChannel.get('attendance')).toHaveLength(1)
    expect(parsed.unreadable).toEqual(['export/attendance/2026-01-09.json'])
  })
})
