// Permission rules for the BOM's catalog of bought parts (bom_catalog, #20):
// everyone on the team can read it. Only student leaders, mentors and admins
// can add, change and delete entries, the same as parts (bom.test.ts).
import { beforeEach, describe, expect, it } from 'vitest'
import { PERMISSION_DENIED, setUpTestDatabase } from './database'

const db = setUpTestDatabase()
let student: string
let leader: string
let mentor: string

beforeEach(async () => {
  student = await db.member('Riley Park')
  leader = await db.member('Casey Leader', 'leader')
  mentor = await db.member('Pat Mentor', 'mentor')
})

const addEntry = (person: string | null, vendorPartNumber = 'EXAMPLE-NEO-01', vendor = 'REV Robotics', link = 'https://example.com/neo') =>
  db.as<{ id: string; created_by: string }>(
    person,
    "insert into public.bom_catalog (vendor, vendor_part_number, name, product_url) values ($1, $2, 'Brushless motor', $3) returning *",
    [vendor, vendorPartNumber, link],
  )

describe('the BOM catalog', () => {
  it('can be read by a student', async () => {
    await addEntry(mentor)
    expect(await db.as(student, 'select id from public.bom_catalog')).toHaveLength(1)
  })

  it('can be added to by a student leader or a mentor, signed with their own id, but not by a student', async () => {
    const [fromLeader] = await addEntry(leader)
    expect(fromLeader.created_by).toBe(leader)
    const [fromMentor] = await addEntry(mentor, 'EXAMPLE-CW-2', 'Andy Mark')
    expect(fromMentor.created_by).toBe(mentor)
    await expect(addEntry(student, 'EXAMPLE-BRG-12', 'West Coast Products')).rejects.toThrow(PERMISSION_DENIED)
  })

  it("doesn't let anyone add an entry as someone else", async () => {
    await expect(
      db.as(leader, "insert into public.bom_catalog (vendor, vendor_part_number, name, product_url, created_by) values ('WCP', 'X-1', 'Bearing', 'https://example.com/x', $1)", [mentor]),
    ).rejects.toThrow(PERMISSION_DENIED)
  })

  it('lets student leaders, but not students, change and delete entries', async () => {
    const [entry] = await addEntry(mentor)
    expect(await db.as(student, "update public.bom_catalog set name = 'Changed' returning id")).toEqual([])
    expect(await db.as(student, 'delete from public.bom_catalog returning id')).toEqual([])
    expect(await db.as(leader, "update public.bom_catalog set name = 'NEO motor' returning id")).toEqual([{ id: entry.id }])
    expect(await db.sql('select name from public.bom_catalog')).toEqual([{ name: 'NEO motor' }])
    expect(await db.as(leader, 'delete from public.bom_catalog returning id')).toEqual([{ id: entry.id }])
  })

  it("doesn't let anyone change who added an entry", async () => {
    await addEntry(leader)
    for (const person of [student, leader, mentor]) {
      await expect(db.as(person, 'update public.bom_catalog set created_by = $1', [mentor])).rejects.toThrow(PERMISSION_DENIED)
    }
  })

  it("doesn't let a student leader whose access is off add, change or delete entries", async () => {
    const [entry] = await addEntry(mentor)
    await db.switchOff(leader)
    await expect(addEntry(leader, 'EXAMPLE-CW-2', 'Andy Mark')).rejects.toThrow(PERMISSION_DENIED)
    expect(await db.as(leader, "update public.bom_catalog set name = 'Changed' where id = $1 returning id", [entry.id])).toEqual([])
    expect(await db.as(leader, 'delete from public.bom_catalog where id = $1 returning id', [entry.id])).toEqual([])
  })

  it("can't be read or added to by someone who isn't signed in, or read by someone whose access is off", async () => {
    await addEntry(mentor)
    await expect(db.as(null, 'select * from public.bom_catalog')).rejects.toThrow(PERMISSION_DENIED)
    await expect(addEntry(null)).rejects.toThrow(PERMISSION_DENIED)
    await db.switchOff(student)
    expect(await db.as(student, 'select * from public.bom_catalog')).toEqual([])
  })

  it('only accepts whole https:// links, and needs one', async () => {
    const refused = ['javascript:alert(1)', 'http://example.com/neo', 'https://example.com/a b', `https://example.com/${'x'.repeat(2000)}`]
    for (const link of refused) {
      await expect(addEntry(leader, 'EXAMPLE-NEO-01', 'REV Robotics', link), link).rejects.toThrow('check constraint')
    }
    await expect(
      db.as(leader, "insert into public.bom_catalog (vendor, vendor_part_number, name) values ('WCP', 'X-1', 'Bearing')"),
    ).rejects.toThrow('not-null')
    const [entry] = await addEntry(leader)
    await expect(
      db.as(leader, "update public.bom_catalog set product_url = 'javascript:alert(1)' where id = $1", [entry.id]),
    ).rejects.toThrow('check constraint')
  })

  it('keeps one entry per vendor and vendor part number, ignoring capitals and spaces', async () => {
    await addEntry(leader, 'EXAMPLE-NEO-01', 'REV Robotics')
    await expect(addEntry(leader, ' example-neo-01', 'rev robotics')).rejects.toThrow('duplicate key')
    // Another vendor can use the same number.
    await addEntry(leader, 'EXAMPLE-NEO-01', 'Andy Mark')
    expect(await db.sql('select count(*)::int as n from public.bom_catalog')).toEqual([{ n: 2 }])
  })
})
