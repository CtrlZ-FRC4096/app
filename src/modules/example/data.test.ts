// Tests for data.ts. Run them with `npm test`.
// Each test starts from the example data, so tests can't affect each other.
import { beforeEach, describe, expect, it } from 'vitest'
import { MAX_NOTE_LENGTH, addNote, noteCount, notesStore, removeNote } from './data'

beforeEach(() => {
  notesStore.reset()
})

describe('addNote', () => {
  it('adds a note to the top of the list, trimmed', () => {
    const result = addNote('  Bring a laptop  ', 'Test Student')
    expect(result.ok).toBe(true)
    expect(notesStore.get()[0]).toMatchObject({ text: 'Bring a laptop', author: 'Test Student' })
    expect(noteCount()).toBe(3)
  })

  it('refuses an empty note and says why', () => {
    expect(addNote('   ', 'Test Student')).toEqual({ ok: false, error: 'Write something first.' })
    expect(noteCount()).toBe(2)
  })

  it('refuses a note that is too long', () => {
    const result = addNote('x'.repeat(MAX_NOTE_LENGTH + 1), 'Test Student')
    expect(result.ok).toBe(false)
  })
})

describe('removeNote', () => {
  it('removes only the note asked for', () => {
    removeNote('n1')
    expect(notesStore.get().map((n) => n.id)).toEqual(['n2'])
  })
})
