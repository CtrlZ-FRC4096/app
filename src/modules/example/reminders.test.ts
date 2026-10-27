// Tests for the example Slack reminder (reminders.ts). Copy these with it.
import { describe, expect, it } from 'vitest'
import type { Member } from '../../core/members'
import { APP_ADDRESS } from '../../core/slack'
import type { Note } from './data'
import { notesThanks, weeklyNotesThanks } from './reminders'

const alex: Member = { id: 'a', slack_user_id: 'U0DEMO0001', name: 'Alex Rivera', avatar_url: null, role: 'student', active: true, created_at: '' }
const jordan: Member = { ...alex, id: 'j', slack_user_id: 'U0DEMO0004', name: 'Jordan Kim' }
const note = (created_by: string, created_at: string): Note => ({ id: created_at, text: 'Hi', created_by, created_at })
const monday = { date: '2026-11-02', day: 'Mon' as const }

describe('notesThanks', () => {
  it('counts the notes and links to them', () => {
    expect(notesThanks('Alex Rivera', 1)).toBe(`Thanks for posting 1 note last week, Alex Rivera! <${APP_ADDRESS}#/example|See the notes>`)
    expect(notesThanks('Alex Rivera', 3)).toMatch(/^Thanks for posting 3 notes/)
  })
})

describe('weeklyNotesThanks', () => {
  it('goes out on Mondays', () => {
    expect(weeklyNotesThanks.days).toEqual(['Mon'])
  })

  it('messages each person who posted in the last week, once', () => {
    const notes = [note('a', '2026-10-30T18:00:00Z'), note('a', '2026-11-01T18:00:00Z'), note('j', '2026-10-01T18:00:00Z')]
    expect(weeklyNotesThanks.messages({ members: [alex, jordan], example_notes: notes }, monday)).toEqual([
      { to: 'U0DEMO0001', text: notesThanks('Alex Rivera', 2) },
    ])
  })

  it('sends nothing in a quiet week', () => {
    expect(weeklyNotesThanks.messages({ members: [alex, jordan], example_notes: [] }, monday)).toEqual([])
  })
})
