// Permission rules for the Inventory module's table. One test for each thing
// the rules should allow or stop.
import { beforeEach, describe, expect, it } from 'vitest'
import { PERMISSION_DENIED, setUpTestDatabase } from './database'

const db = setUpTestDatabase()
let student: string
let mentor: string

beforeEach(async () => {
  student = await db.member('Riley Park')
  mentor = await db.member('Pat Mentor', 'mentor')
})

const add = (person: string, partNumber = 'REV-11-1850', quantity = 2) =>
  db.as<{ id: string; created_by: string }>(
    person,
    `insert into public.inventory_items (name, vendor, vendor_part_number, location, quantity, low_stock_level)
     values ('Power Distribution Hub', 'REV', $1, 'Shelf E1', $2, 1) returning *`,
    [partNumber, quantity],
  )

describe('inventory items', () => {
  it('lets a mentor add a part, signed with their own id', async () => {
    const [part] = await add(mentor)
    expect(part.created_by).toBe(mentor)
  })

  it('lets a student add a part, signed with their own id', async () => {
    const [part] = await add(student)
    expect(part.created_by).toBe(student)
  })

  it("doesn't let someone whose access is off add a part", async () => {
    await db.switchOff(student)
    await expect(add(student)).rejects.toThrow(PERMISSION_DENIED)
  })

  it("doesn't let anyone add a part as someone else", async () => {
    await expect(
      db.as(
        mentor,
        `insert into public.inventory_items (name, vendor, vendor_part_number, location, created_by)
         values ('CANivore', 'CTR Electronics', '21-678682', 'Bin E2', $1)`,
        [student],
      ),
    ).rejects.toThrow(PERMISSION_DENIED)
    await expect(
      db.as(
        student,
        `insert into public.inventory_items (name, vendor, vendor_part_number, location, created_by)
         values ('CANivore', 'CTR Electronics', '21-678682', 'Bin E2', $1)`,
        [mentor],
      ),
    ).rejects.toThrow(PERMISSION_DENIED)
  })

  it('lets members read parts', async () => {
    await add(mentor)
    expect(await db.as(student, 'select name from public.inventory_items')).toEqual([{ name: 'Power Distribution Hub' }])
  })

  it('can be changed by a mentor but not by a student', async () => {
    const [part] = await add(mentor)
    expect(await db.as(student, 'update public.inventory_items set quantity = 9 where id = $1 returning id', [part.id])).toEqual([])
    expect(await db.as(mentor, 'update public.inventory_items set quantity = 9 where id = $1 returning quantity', [part.id])).toEqual([{ quantity: 9 }])
  })

  it('can be removed by a mentor but not by a student', async () => {
    const [part] = await add(mentor)
    expect(await db.as(student, 'delete from public.inventory_items where id = $1 returning id', [part.id])).toEqual([])
    expect(await db.as(mentor, 'delete from public.inventory_items where id = $1 returning id', [part.id])).toEqual([{ id: part.id }])
  })

  it('refuses a negative quantity', async () => {
    await expect(add(mentor, 'REV-11-1850', -1)).rejects.toThrow('check constraint')
  })

  it('refuses the same vendor and part number twice', async () => {
    await add(mentor)
    await expect(add(mentor)).rejects.toThrow('unique constraint')
  })

  it("can't be read or added by someone who isn't signed in", async () => {
    await add(mentor)
    await expect(db.as(null, 'select * from public.inventory_items')).rejects.toThrow(PERMISSION_DENIED)
    await expect(
      db.as(null, "insert into public.inventory_items (name, vendor, vendor_part_number, location) values ('CANivore', 'CTR Electronics', '21-678682', 'Bin E2')"),
    ).rejects.toThrow(PERMISSION_DENIED)
  })

  it("can't be read by someone whose access is off", async () => {
    await add(mentor)
    await db.switchOff(student)
    expect(await db.as(student, 'select * from public.inventory_items')).toEqual([])
  })
})
