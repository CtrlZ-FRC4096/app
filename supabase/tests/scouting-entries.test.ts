// Permission rules for the Scouting module's table of match entries.
import { beforeEach, describe, expect, it } from 'vitest'
import { PERMISSION_DENIED, setUpTestDatabase } from './database'

const db = setUpTestDatabase()
let student: string
let otherStudent: string
let mentor: string

beforeEach(async () => {
  student = await db.member('Riley Park')
  otherStudent = await db.member('Casey Lin')
  mentor = await db.member('Pat Mentor', 'mentor')
})

let ids = 0
/** A new id, like the one a phone makes for each entry. */
const newId = () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`

// The way the app sends an entry: with the phone's id, skipping it quietly
// if the database already has that id.
const send = (person: string, fields: { id?: string; created_by?: string; stop?: string; driver_skill?: number | null } = {}) =>
  db.as<{ id: string; created_by: string }>(
    person,
    `insert into public.scouting_entries (id, created_by, event, match, team, counts, endgame, roles, broke_down, stop, driver_skill, notes)
     values ($1, $2, '2026ilch', 12, 9991, '{"autoFuel": 3}', 'Level 2', '{Scorer}', false, $3, $4, 'Fast cycles')
     on conflict (id) do nothing
     returning id, created_by`,
    [fields.id ?? newId(), fields.created_by ?? person, fields.stop ?? 'None', fields.driver_skill === undefined ? 4 : fields.driver_skill],
  )

describe('scouting entries', () => {
  it('lets a member send their own entry', async () => {
    const [entry] = await send(student)
    expect(entry.created_by).toBe(student)
  })

  it("doesn't let anyone send an entry as someone else", async () => {
    await expect(send(student, { created_by: otherStudent })).rejects.toThrow(PERMISSION_DENIED)
  })

  it('keeps one row when the same entry is sent twice', async () => {
    const id = newId()
    expect(await send(student, { id })).toHaveLength(1)
    expect(await send(student, { id })).toEqual([])
    expect(await db.sql('select id from public.scouting_entries')).toEqual([{ id }])
  })

  it('refuses a second row with the same id, even without "on conflict"', async () => {
    const [entry] = await send(student)
    await expect(
      db.sql("insert into public.scouting_entries (id, event, match, team, endgame) values ($1, '2026ilch', 1, 1, 'None')", [entry.id]),
    ).rejects.toThrow('duplicate key')
  })

  it("lets every member read everyone's entries", async () => {
    await send(student)
    await send(otherStudent)
    expect(await db.as(student, 'select id from public.scouting_entries')).toHaveLength(2)
  })

  it('refuses a stop or driver skill that is not on the form', async () => {
    await expect(send(student, { stop: 'Tipped' })).rejects.toThrow('check constraint')
    await expect(send(student, { driver_skill: 0 })).rejects.toThrow('check constraint')
    await expect(send(student, { driver_skill: 6 })).rejects.toThrow('check constraint')
  })

  it('accepts an entry with no driver skill, from before it was on the form', async () => {
    expect(await send(student, { driver_skill: null })).toHaveLength(1)
  })

  it("can't be read or sent by someone who isn't signed in", async () => {
    await send(student)
    await expect(db.as(null, 'select * from public.scouting_entries')).rejects.toThrow(PERMISSION_DENIED)
    await expect(
      db.as(null, "insert into public.scouting_entries (id, event, match, team, endgame) values ($1, '2026ilch', 1, 1, 'None')", [newId()]),
    ).rejects.toThrow(PERMISSION_DENIED)
  })

  it("can't be read or sent by someone whose access is off", async () => {
    await send(student)
    await db.switchOff(student)
    expect(await db.as(student, 'select * from public.scouting_entries')).toEqual([])
    await expect(send(student)).rejects.toThrow(PERMISSION_DENIED)
  })

  it('can be changed by a mentor but not by a student, even their own', async () => {
    const [entry] = await send(student)
    expect(await db.as(student, 'update public.scouting_entries set team = 9992 where id = $1 returning id', [entry.id])).toEqual([])
    expect(await db.as(mentor, 'update public.scouting_entries set team = 9992 where id = $1 returning id', [entry.id])).toEqual([{ id: entry.id }])
  })

  it('can be deleted by a mentor but not by a student, even their own', async () => {
    const [entry] = await send(student)
    expect(await db.as(student, 'delete from public.scouting_entries where id = $1 returning id', [entry.id])).toEqual([])
    expect(await db.as(mentor, 'delete from public.scouting_entries where id = $1 returning id', [entry.id])).toEqual([{ id: entry.id }])
  })
})
