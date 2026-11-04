// Permission rules for the Purchasing module's table. Like the Slack list it
// replaces, anyone on the team can add, change and delete any item; nobody
// else can see or touch them.
import { beforeEach, describe, expect, it } from 'vitest'
import { PERMISSION_DENIED, setUpTestDatabase } from './database'

const db = setUpTestDatabase()
let student: string
let other: string
let mentor: string

beforeEach(async () => {
  student = await db.member('Riley Park')
  other = await db.member('Casey Lee')
  mentor = await db.member('Pat Mentor', 'mentor')
})

interface Item {
  id: string
  status: string
  requested_by: string | null
  created_by: string
}

const add = (person: string, name = 'Ethernet cables, 5 ft (10 pack)') =>
  db.as<Item>(person, "insert into public.purchase_items (name, vendor, type, quantity) values ($1, 'Amazon', 'Electrical', 1) returning *", [name])

describe('purchase items', () => {
  it('lets a member add an item, signed with their own id, as requested by them and set to Order', async () => {
    const [item] = await add(student)
    expect(item).toMatchObject({ created_by: student, requested_by: student, status: 'order' })
  })

  it("doesn't let anyone say someone else asked for it, not even a mentor", async () => {
    for (const [person, someoneElse] of [[student, other], [mentor, student]]) {
      await expect(
        db.as(person, "insert into public.purchase_items (name, vendor, type, quantity, requested_by) values ('Belt', 'WCP', 'Drive Base', 2, $1)", [someoneElse]),
      ).rejects.toThrow(PERMISSION_DENIED)
    }
  })

  it("doesn't let anyone change who asked for an item later, not even a mentor", async () => {
    const [item] = await add(student)
    for (const person of [student, other, mentor]) {
      await expect(
        db.as(person, 'update public.purchase_items set requested_by = $2 where id = $1', [item.id, person === student ? other : person]),
      ).rejects.toThrow(PERMISSION_DENIED)
    }
    expect(await db.sql('select requested_by from public.purchase_items where id = $1', [item.id])).toEqual([{ requested_by: student }])
  })

  it("doesn't let anyone add an item as if someone else added it", async () => {
    await expect(
      db.as(student, "insert into public.purchase_items (name, vendor, type, quantity, created_by) values ('Belt', 'WCP', 'Drive Base', 1, $1)", [mentor]),
    ).rejects.toThrow(PERMISSION_DENIED)
  })

  it('refuses an empty name, a quantity under 1, a made-up status, and links that are not https', async () => {
    await expect(add(student, '  ')).rejects.toThrow('check constraint')
    await expect(db.as(student, "insert into public.purchase_items (name, vendor, type, quantity) values ('Belt', 'WCP', 'Drive Base', 0)")).rejects.toThrow('check constraint')
    await expect(
      db.as(student, "insert into public.purchase_items (name, vendor, type, quantity, status) values ('Belt', 'WCP', 'Drive Base', 1, 'lost')"),
    ).rejects.toThrow('check constraint')
    await expect(
      db.as(student, "insert into public.purchase_items (name, vendor, type, quantity, link) values ('Belt', 'WCP', 'Drive Base', 1, 'javascript:alert(1)')"),
    ).rejects.toThrow('check constraint')
  })

  it('needs a vendor and a type', async () => {
    await expect(db.as(student, "insert into public.purchase_items (name, type, quantity) values ('Belt', 'Drive Base', 1)")).rejects.toThrow('not-null')
    await expect(db.as(student, "insert into public.purchase_items (name, vendor, quantity) values ('Belt', 'WCP', 1)")).rejects.toThrow('not-null')
  })

  it("can't be read or added by someone who isn't signed in", async () => {
    await add(student)
    await expect(db.as(null, 'select * from public.purchase_items')).rejects.toThrow(PERMISSION_DENIED)
    await expect(
      db.as(null, "insert into public.purchase_items (name, vendor, type, quantity) values ('Belt', 'WCP', 'Drive Base', 1)"),
    ).rejects.toThrow(PERMISSION_DENIED)
  })

  it("can't be read, added, changed or deleted by someone whose access is off", async () => {
    const [item] = await add(other)
    await db.switchOff(student)
    expect(await db.as(student, 'select * from public.purchase_items')).toEqual([])
    await expect(add(student)).rejects.toThrow(PERMISSION_DENIED)
    expect(await db.as(student, "update public.purchase_items set status = 'cancelled' where id = $1 returning id", [item.id])).toEqual([])
    expect(await db.as(student, 'delete from public.purchase_items where id = $1 returning id', [item.id])).toEqual([])
  })

  it("lets any member change anyone's request, including its priority", async () => {
    const [item] = await add(student)
    expect(
      await db.as(other, "update public.purchase_items set status = 'order_high', quantity = 3 where id = $1 returning status, quantity", [item.id]),
    ).toEqual([{ status: 'order_high', quantity: 3 }])
  })

  it("doesn't let anyone change who added an item, or when", async () => {
    const [item] = await add(student)
    await expect(db.as(mentor, 'update public.purchase_items set created_by = $2 where id = $1', [item.id, mentor])).rejects.toThrow(PERMISSION_DENIED)
    await expect(db.as(mentor, "update public.purchase_items set created_at = now() where id = $1", [item.id])).rejects.toThrow(PERMISSION_DENIED)
  })

  it("lets any member delete anyone's item", async () => {
    const [item] = await add(student)
    expect(await db.as(other, 'delete from public.purchase_items where id = $1 returning id', [item.id])).toEqual([{ id: item.id }])
  })
})

describe('purchase items for a BOM part', () => {
  const bomPart = async () => {
    const [{ id: robot }] = await db.sql<{ id: string }>("insert into public.bom_robots (name) values ('Robot') returning id")
    const [{ id: system }] = await db.sql<{ id: string }>("insert into public.bom_systems (robot_id, name, code) values ($1, 'Intake', 'INT') returning id", [robot])
    const [{ id }] = await db.sql<{ id: string }>(
      "insert into public.bom_parts (system_id, part_number, name, kind, vendor, quantity) values ($1, '4096-26-INT-004', 'Bearing', 'cots', 'WCP', 6) returning id",
      [system],
    )
    return id
  }

  const askFor = (person: string, part: string) =>
    db.as<{ id: string; bom_part_id: string | null }>(
      person,
      "insert into public.purchase_items (name, vendor, type, quantity, bom_part_id) values ('Bearing', 'West Coast Products', 'Intake', 6, $1) returning *",
      [part],
    )

  it('lets a member ask for a BOM part, linked to it', async () => {
    const part = await bomPart()
    const [item] = await askFor(student, part)
    expect(item.bom_part_id).toBe(part)
  })

  it("doesn't let anyone change which BOM part a request is for", async () => {
    const part = await bomPart()
    const [item] = await askFor(student, part)
    await expect(db.as(mentor, 'update public.purchase_items set bom_part_id = null where id = $1', [item.id])).rejects.toThrow(PERMISSION_DENIED)
  })

  it('keeps the request, unlinked, when the BOM part is deleted', async () => {
    const part = await bomPart()
    const [item] = await askFor(student, part)
    await db.sql('delete from public.bom_parts where id = $1', [part])
    expect(await db.sql('select bom_part_id from public.purchase_items where id = $1', [item.id])).toEqual([{ bom_part_id: null }])
  })
})
