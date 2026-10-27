/**
 * Example module data: short notes anyone on the team can post.
 *
 * This module exists to be copied. It shows the pattern every module
 * follows:
 *
 *   - Data lives in a table from createTable(). In the team database the
 *     table is made by a migration, supabase/migrations/..._example_notes.sql,
 *     which also sets who can read, add and delete notes.
 *   - Pages call the functions in this file and never save anything
 *     themselves.
 *   - Rules (like "a note can't be empty") are checked here first, so the
 *     page can show a clear message. The database checks them again,
 *     because anyone can send it anything.
 *   - Functions that can fail return { ok: true, value } or
 *     { ok: false, error }, with the error written for the person using it.
 *   - Example data is clearly made up.
 *   - Anything that needs a secret key, like sending a Slack message, goes
 *     through a server function: see sendMeASlackMessage() at the bottom.
 */
import { createTable, fail, newestFirst, ok, type Result, type Row } from '../../core/table'
import { DEMO_PEOPLE } from '../../core/demo'
import { plural } from '../../core/format'
import { currentUser } from '../../core/session'
import { appLink, sendSlackToMe, slackEscape } from '../../core/slack'
import { isLive } from '../../core/supabase'
import type { Notice } from '../../core/registry'

/** One row of the example_notes table. The fields match its columns. */
export interface Note extends Row {
  text: string
  /** Who posted it. Show their name with useMemberNames(). */
  created_by: string | null
}

/** The database allows the same: see the check on the text column. */
export const MAX_NOTE_LENGTH = 200

const EXAMPLE_NOTES: Note[] = [
  {
    id: '00000000-0000-4000-8000-0000000e0001',
    text: 'Shop is open until 9 on Thursday.',
    created_at: '2026-10-24T23:00:00Z',
    created_by: DEMO_PEOPLE.pat,
  },
  {
    id: '00000000-0000-4000-8000-0000000e0002',
    text: 'Safety glasses are back in the bin by the door.',
    created_at: '2026-10-23T00:15:00Z',
    created_by: DEMO_PEOPLE.jordan,
  },
]

export const notesTable = createTable<Note>('example_notes', { demo: EXAMPLE_NOTES, sort: newestFirst })

/** Every note, newest first. */
export function useNotes(): Note[] {
  return notesTable.useRows()
}

/** The home page tile's status. */
export function useNoteSummary(): Notice {
  const notes = useNotes()
  return { tone: 'info', text: plural(notes.length, 'note', 'notes') }
}

/** Why a note can't be posted, or null if it can. */
export function checkNote(text: string): string | null {
  const trimmed = text.trim()
  if (!trimmed) return 'Write something first.'
  if (trimmed.length > MAX_NOTE_LENGTH) return `Keep it under ${MAX_NOTE_LENGTH} characters. This one is ${trimmed.length}.`
  return null
}

export async function addNote(text: string): Promise<Result<Note>> {
  const problem = checkNote(text)
  if (problem) return fail(problem)
  return notesTable.insert({ text: text.trim() })
}

/** Mentors and admins only. The database refuses anyone else. */
export async function removeNote(id: string): Promise<Result> {
  return notesTable.remove(id)
}

// ---------------------------------------------------------------------------
// Slack: the "Send me a Slack message" button.
//
// How it works, step by step:
//   1. The page's button calls sendMeASlackMessage() below.
//   2. That builds the message with slackHello(), a plain function with
//      tests, and calls sendSlackToMe() from src/core/slack.ts.
//   3. sendSlackToMe() calls the `slack` server function on Supabase
//      (supabase/functions/slack/). The browser never sees the bot's key:
//      only the server function has it.
//   4. The server function checks you're on the team, and the team's Slack
//      bot sends the message to you.
// In demo mode there are no server functions, so nothing is sent.

/** The message the button sends you. */
export function slackHello(name: string, noteCount: number): string {
  return (
    `Hi ${slackEscape(name)}! You pressed "Send me a Slack message" on the Example page, ` +
    `so the team's Slack bot sent you this. There are ${plural(noteCount, 'note', 'notes')} posted. ` +
    appLink('example', 'Open the Example page')
  )
}

/** Send yourself a Slack message. The answer is what to tell the person. */
export async function sendMeASlackMessage(): Promise<Result<string>> {
  const me = currentUser()
  if (!me) return fail('Sign in first.')
  const sent = await sendSlackToMe(slackHello(me.name, notesTable.rows().length))
  if (!sent.ok) return sent
  return ok(isLive ? 'Sent. Look in Slack for a direct message from the team app.' : 'Demo mode: nothing was sent. On the live site, the Slack bot messages you.')
}
