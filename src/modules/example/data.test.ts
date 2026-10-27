// Tests for data.ts. Run them with `npm test`.
// They run in demo mode, and each test starts from the example notes, so
// tests can't affect each other. Who is allowed to do what is the
// database's job: that's tested in supabase/tests/example-notes.test.ts.
import { beforeEach, describe, expect, it } from 'vitest'
import { APP_ADDRESS } from '../../core/slack'
import { MAX_NOTE_LENGTH, addNote, checkNote, notesTable, removeNote, sendMeASlackMessage, slackHello } from './data'

beforeEach(() => {
  notesTable.reset()
})

describe('addNote', () => {
  it('adds a note to the top of the list, trimmed', async () => {
    const result = await addNote('  Bring a laptop  ')
    expect(result.ok).toBe(true)
    expect(notesTable.rows()[0]).toMatchObject({ text: 'Bring a laptop' })
    expect(notesTable.rows()).toHaveLength(3)
  })

  it('refuses an empty note and says why', async () => {
    expect(await addNote('   ')).toEqual({ ok: false, error: 'Write something first.' })
    expect(notesTable.rows()).toHaveLength(2)
  })

  it('refuses a note that is too long', async () => {
    const result = await addNote('x'.repeat(MAX_NOTE_LENGTH + 1))
    expect(result.ok).toBe(false)
  })
})

describe('checkNote', () => {
  it('allows a note of exactly the longest length', () => {
    expect(checkNote('x'.repeat(MAX_NOTE_LENGTH))).toBeNull()
  })
})

describe('removeNote', () => {
  it('removes only the note asked for', async () => {
    const [first, second] = notesTable.rows()
    expect(await removeNote(first.id)).toEqual({ ok: true, value: null })
    expect(notesTable.rows().map((n) => n.id)).toEqual([second.id])
  })

  it('says so if the note is already gone', async () => {
    expect((await removeNote('not-a-note')).ok).toBe(false)
  })
})

describe('slackHello', () => {
  it('says hi, counts the notes, and links to the page', () => {
    expect(slackHello('Alex Rivera', 2)).toBe(
      'Hi Alex Rivera! You pressed "Send me a Slack message" on the Example page, so the team\'s Slack bot sent you this. ' +
        `There are 2 notes posted. <${APP_ADDRESS}#/example|Open the Example page>`,
    )
  })

  it('shows names exactly as typed', () => {
    expect(slackHello('<Pat>', 1)).toMatch(/^Hi &lt;Pat&gt;! .* 1 note posted/)
  })
})

describe('sendMeASlackMessage', () => {
  it('says nothing was sent in demo mode', async () => {
    expect(await sendMeASlackMessage()).toEqual({ ok: true, value: 'Demo mode: nothing was sent. On the live site, the Slack bot messages you.' })
  })
})
