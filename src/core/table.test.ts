import { beforeEach, describe, expect, it } from 'vitest'
import { applyChange, createTable, explain, newestFirst, type Row } from './table'
import { DEMO_PEOPLE, setDemoRole } from './demo'

interface Thing extends Row {
  name: string
  created_by: string | null
}

const things = createTable<Thing>('test_things', {
  demo: [
    { id: 'a', name: 'Older', created_at: '2026-01-01T00:00:00Z', created_by: null },
    { id: 'b', name: 'Newer', created_at: '2026-02-01T00:00:00Z', created_by: null },
  ],
  sort: newestFirst,
})

beforeEach(() => {
  things.reset()
  setDemoRole('student')
})

describe('a demo table', () => {
  it('starts with the example rows, in order', () => {
    expect(things.rows().map((t) => t.name)).toEqual(['Newer', 'Older'])
  })

  it('fills in id, created_at and created_by when adding a row', async () => {
    const result = await things.insert({ name: 'New' })
    if (!result.ok) throw new Error(result.error)
    expect(result.value.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(result.value.created_by).toBe(DEMO_PEOPLE.alex)
    expect(things.rows()[0].name).toBe('New')
  })

  it('changes one row', async () => {
    await things.update('a', { name: 'Renamed' })
    expect(things.rows().map((t) => t.name)).toEqual(['Newer', 'Renamed'])
  })

  it("says so when the row isn't there", async () => {
    expect(await things.update('nope', { name: 'X' })).toEqual({ ok: false, error: 'That has already been deleted.' })
    expect((await things.remove('nope')).ok).toBe(false)
  })

  it('adds many rows at once', async () => {
    const result = await things.insertMany([{ name: 'One' }, { name: 'Two' }])
    expect(result.ok && result.value.map((t) => t.name)).toEqual(['One', 'Two'])
    expect(things.rows()).toHaveLength(4)
  })

  it('puts the example rows back on reset', async () => {
    await things.remove('a')
    things.reset()
    expect(things.rows()).toHaveLength(2)
  })
})

describe('applyChange', () => {
  const rows: Thing[] = [{ id: 'a', name: 'A', created_at: '', created_by: null }]

  it('adds, replaces and removes rows the way the database reports changes', () => {
    const added = applyChange(rows, { eventType: 'INSERT', new: { id: 'b', name: 'B', created_at: '', created_by: null }, old: {} })
    expect(added.map((t) => t.id)).toEqual(['a', 'b'])
    const changed = applyChange(added, { eventType: 'UPDATE', new: { id: 'a', name: 'A2', created_at: '', created_by: null }, old: { id: 'a' } })
    expect(changed.map((t) => t.name)).toEqual(['A2', 'B'])
    expect(applyChange(changed, { eventType: 'DELETE', new: {}, old: { id: 'a' } }).map((t) => t.id)).toEqual(['b'])
  })
})

describe('explain', () => {
  it('turns database errors into messages for people', () => {
    expect(explain({ code: '42501', message: 'new row violates row-level security policy' })).toBe("You don't have permission to do that.")
    expect(explain({ code: 'P0001', message: 'The team needs at least one admin. Make someone else an admin first.' })).toBe(
      'The team needs at least one admin. Make someone else an admin first.',
    )
    expect(explain({ message: 'TypeError: Failed to fetch' })).toMatch(/Couldn't reach the team database/)
  })
})
