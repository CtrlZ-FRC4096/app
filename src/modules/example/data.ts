/**
 * Example module data: short notes anyone on the team can post.
 *
 * This module exists to be copied. It shows the pattern every module
 * follows:
 *
 *   - Data lives in data.ts. Pages call these functions and never touch
 *     storage directly, so when the team database is ready only this file
 *     changes.
 *   - Rules (like "a note can't be empty") are plain functions that return
 *     an error message, so they are easy to test and the page can show the
 *     message as it is.
 *   - Example data is clearly made up.
 */
import { createStore, useStore } from '../../core/store'

export interface Note {
  id: string
  text: string
  author: string
  /** ISO date and time. */
  posted: string
}

export const MAX_NOTE_LENGTH = 200

const EXAMPLE_NOTES: Note[] = [
  { id: 'n1', text: 'Shop is open until 9 on Thursday.', author: 'Pat Chen', posted: '2026-10-24T18:00:00' },
  { id: 'n2', text: 'Safety glasses are back in the bin by the door.', author: 'Jordan Kim', posted: '2026-10-22T19:15:00' },
]

// Raise the version number (1) if you change what a Note looks like, so old
// saved copies are ignored instead of breaking the page.
export const notesStore = createStore('example-notes', 1, () => EXAMPLE_NOTES.map((n) => ({ ...n })))

export function useNotes(): Note[] {
  return useStore(notesStore)
}

export type AddResult = { ok: true; note: Note } | { ok: false; error: string }

export function addNote(text: string, author: string, now: Date = new Date()): AddResult {
  const trimmed = text.trim()
  if (!trimmed) return { ok: false, error: 'Write something first.' }
  if (trimmed.length > MAX_NOTE_LENGTH) return { ok: false, error: `Keep it under ${MAX_NOTE_LENGTH} characters. This one is ${trimmed.length}.` }
  const note: Note = { id: `n${now.getTime()}`, text: trimmed, author, posted: now.toISOString() }
  notesStore.set((notes) => [note, ...notes])
  return { ok: true, note }
}

export function removeNote(id: string) {
  notesStore.set((notes) => notes.filter((n) => n.id !== id))
}

export function noteCount(): number {
  return notesStore.get().length
}
