// Permission rules for Inventory's stock history, and for who can change
// what on a part. One test for each thing the rules should allow or stop.
import { beforeEach, describe, expect, it } from 'vitest'
import { PERMISSION_DENIED, setUpTestDatabase } from './database'

const db = setUpTestDatabase()
let student: string
let otherStudent: string
let mentor: string
let part: string

beforeEach(async () => {
  student = await db.member('Riley Park')
  otherStudent = await db.member('Casey Lin')
  mentor = await db.member('Pat Mentor', 'mentor')
  ;[{ id: part }] = await db.as<{ id: string }>(
    mentor,
    "insert into public.inventory_items (name, vendor, vendor_part_number, location, quantity, low_stock_level) values ('Power Distribution Hub', 'REV', 'REV-11-1850', 'Shelf E1', 5, 1) returning id",
  )
})

/** A history line, the way the app records a change. */
const record = (person: string, change = -2, createdBy = person) =>
  db.as<{ id: string; created_by: string }>(
    person,
    "insert into public.inventory_changes (item_id, change, note, created_by) values ($1, $2, 'For the intake', $3) returning id, created_by",
    [part, change, createdBy],
  )

describe('changing a part', () => {
  it('lets a student change how many there are', async () => {
    expect(await db.as(student, 'update public.inventory_items set quantity = 3 where id = $1 returning quantity', [part])).toEqual([{ quantity: 3 }])
  })

  it("doesn't let a student change a part's name, location or low-stock level", async () => {
    for (const change of ["name = 'Renamed'", "location = 'Bin Z9'", 'low_stock_level = 4', "vendor_part_number = 'REV-00'"]) {
      await expect(db.as(student, `update public.inventory_items set ${change} where id = $1`, [part])).rejects.toThrow(
        'Only mentors and admins can change',
      )
    }
  })

  it("doesn't let a student sneak a location change in with a quantity change", async () => {
    await expect(db.as(student, "update public.inventory_items set quantity = 3, location = 'Bin Z9' where id = $1", [part])).rejects.toThrow(
      'Only mentors and admins can change',
    )
    expect(await db.sql('select quantity, location from public.inventory_items')).toEqual([{ quantity: 5, location: 'Shelf E1' }])
  })

  it('lets a student add a part with a product link but not change it after, lets a mentor change it, and only takes https:// links', async () => {
    const [added] = await db.as<{ id: string; link: string }>(
      student,
      "insert into public.inventory_items (name, vendor, vendor_part_number, location, link, created_by) values ('CANivore', 'CTR Electronics', '21-678682', 'Bin E2', 'https://example.com/canivore', $1) returning id, link",
      [student],
    )
    expect(added.link).toBe('https://example.com/canivore')
    const setLink = (person: string, link: string) =>
      db.as<{ link: string }>(person, 'update public.inventory_items set link = $1 where id = $2 returning link', [link, added.id])
    await expect(setLink(student, 'https://example.com/other')).rejects.toThrow('Only mentors and admins can change')
    expect(await setLink(mentor, 'https://example.com/new')).toEqual([{ link: 'https://example.com/new' }])
    await expect(setLink(mentor, 'javascript:alert(1)')).rejects.toThrow('check constraint')
  })

  it('lets a mentor change the location and quantity', async () => {
    expect(
      await db.as(mentor, "update public.inventory_items set quantity = 9, location = 'Bin Z9' where id = $1 returning quantity, location", [part]),
    ).toEqual([{ quantity: 9, location: 'Bin Z9' }])
  })

  it("doesn't let anyone take the quantity below 0", async () => {
    await expect(db.as(student, 'update public.inventory_items set quantity = -1 where id = $1', [part])).rejects.toThrow('check constraint')
  })

  it("doesn't let someone whose access is off change the quantity", async () => {
    await db.switchOff(student)
    expect(await db.as(student, 'update public.inventory_items set quantity = 3 where id = $1 returning id', [part])).toEqual([])
  })
})

describe('stock history', () => {
  it('lets a member record a change, signed with their own id', async () => {
    const [line] = await record(student)
    expect(line.created_by).toBe(student)
  })

  it("doesn't let anyone record a change as someone else", async () => {
    await expect(record(student, -2, otherStudent)).rejects.toThrow(PERMISSION_DENIED)
  })

  it('refuses a change of 0 and notes over 200 characters', async () => {
    await expect(record(student, 0)).rejects.toThrow('check constraint')
    await expect(
      db.as(student, 'insert into public.inventory_changes (item_id, change, note) values ($1, 1, $2)', [part, 'x'.repeat(201)]),
    ).rejects.toThrow('check constraint')
  })

  it("lets every member read everyone's history", async () => {
    await record(student)
    await record(mentor, 10)
    expect(await db.as(otherStudent, 'select change from public.inventory_changes order by change')).toEqual([{ change: -2 }, { change: 10 }])
  })

  it("can't be edited or deleted by anyone, mentors included", async () => {
    const [line] = await record(student)
    for (const person of [student, mentor]) {
      await expect(db.as(person, 'update public.inventory_changes set change = 5 where id = $1', [line.id])).rejects.toThrow(PERMISSION_DENIED)
      await expect(db.as(person, 'delete from public.inventory_changes where id = $1', [line.id])).rejects.toThrow(PERMISSION_DENIED)
    }
  })

  it("can't be read or recorded by someone who isn't signed in", async () => {
    await record(student)
    await expect(db.as(null, 'select * from public.inventory_changes')).rejects.toThrow(PERMISSION_DENIED)
    await expect(db.as(null, 'insert into public.inventory_changes (item_id, change) values ($1, 1)', [part])).rejects.toThrow(PERMISSION_DENIED)
  })

  it("can't be read or recorded by someone whose access is off", async () => {
    await record(student)
    await db.switchOff(student)
    expect(await db.as(student, 'select * from public.inventory_changes')).toEqual([])
    await expect(record(student)).rejects.toThrow(PERMISSION_DENIED)
  })

  it('goes with its part when a mentor deletes the part', async () => {
    await record(student)
    await db.as(mentor, 'delete from public.inventory_items where id = $1', [part])
    expect(await db.sql('select * from public.inventory_changes')).toEqual([])
  })
})
