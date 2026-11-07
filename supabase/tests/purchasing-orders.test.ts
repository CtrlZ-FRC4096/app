// Permission rules for placing orders in Purchasing (#78): anyone on the
// team asks for things and changes their priority, but only mentors and
// purchasers place, cancel and follow up orders, and set Shipped to and
// Ordered by. The database fills in Ordered by with whoever places an order.
// Prices are for everyone to see, and anyone can change one until it's ordered.
// Once an item is ordered, students can't change anything about it.
import { beforeEach, describe, expect, it } from 'vitest'
import { PERMISSION_DENIED, setUpTestDatabase } from './database'

const db = setUpTestDatabase()
let student: string
let buyer: string
let mentor: string

beforeEach(async () => {
  student = await db.member('Riley Park')
  buyer = await db.member('Casey Lee')
  mentor = await db.member('Pat Mentor', 'mentor')
  await db.as(mentor, 'insert into public.purchasing_buyers (member_id) values ($1)', [buyer])
})

interface Item {
  id: string
  status: string
  ordered_by: string | null
  shipped_to: string | null
  estimated_arrival: string | null
  price: string | null
}

const ask = async (person: string, status = 'order') =>
  (await db.as<Item>(person, "insert into public.purchase_items (name, vendor, type, quantity, status) values ('Belt', 'Amazon', 'Drive Base', 2, $1) returning *", [status]))[0]

const setStatus = (person: string, id: string, status: string) =>
  db.as<Item>(person, 'update public.purchase_items set status = $2 where id = $1 returning *', [id, status])

describe('purchasers', () => {
  it('are listed for everyone on the team', async () => {
    expect(await db.as(student, 'select member_id from public.purchasing_buyers')).toEqual([{ member_id: buyer }])
  })

  it('are added and removed by mentors only', async () => {
    await expect(db.as(student, 'insert into public.purchasing_buyers (member_id) values ($1)', [student])).rejects.toThrow(PERMISSION_DENIED)
    await expect(db.as(buyer, 'insert into public.purchasing_buyers (member_id) values ($1)', [student])).rejects.toThrow(PERMISSION_DENIED)
    expect(await db.as(student, 'delete from public.purchasing_buyers returning id')).toEqual([])
    expect(await db.as(mentor, 'delete from public.purchasing_buyers where member_id = $1 returning member_id', [buyer])).toEqual([{ member_id: buyer }])
  })
})

describe('placing orders', () => {
  it('lets a student change the priority of what is being asked for', async () => {
    const item = await ask(student, 'wait')
    expect((await setStatus(student, item.id, 'order_high'))[0].status).toBe('order_high')
  })

  it("doesn't let a student place, cancel or follow up an order", async () => {
    const item = await ask(student)
    await expect(setStatus(student, item.id, 'placed')).rejects.toThrow(PERMISSION_DENIED)
    await expect(setStatus(student, item.id, 'cancelled')).rejects.toThrow(PERMISSION_DENIED)
    await setStatus(buyer, item.id, 'placed')
    await expect(setStatus(student, item.id, 'received')).rejects.toThrow(PERMISSION_DENIED)
    await expect(setStatus(student, item.id, 'order')).rejects.toThrow(PERMISSION_DENIED)
  })

  it("doesn't let a student add an item that's already ordered, or say who it ships to", async () => {
    await expect(ask(student, 'placed')).rejects.toThrow(PERMISSION_DENIED)
    await expect(
      db.as(student, "insert into public.purchase_items (name, vendor, type, quantity, shipped_to) values ('Belt', 'Amazon', 'Drive Base', 1, $1)", [student]),
    ).rejects.toThrow(PERMISSION_DENIED)
  })

  it('lets a purchaser and a mentor place orders, and fills in Ordered by with them', async () => {
    const first = await ask(student)
    expect((await setStatus(buyer, first.id, 'placed'))[0]).toMatchObject({ status: 'placed', ordered_by: buyer })
    const second = await ask(student)
    expect((await setStatus(mentor, second.id, 'placed'))[0]).toMatchObject({ status: 'placed', ordered_by: mentor })
  })

  it('keeps Ordered by when the order moves on', async () => {
    const item = await ask(student)
    await setStatus(buyer, item.id, 'placed')
    expect((await setStatus(mentor, item.id, 'backordered'))[0]).toMatchObject({ status: 'backordered', ordered_by: buyer })
  })

  it('uses who a purchaser picks, when they place an order for someone else', async () => {
    const item = await ask(student)
    const [placed] = await db.as<Item>(buyer, "update public.purchase_items set status = 'placed', ordered_by = $2 where id = $1 returning *", [item.id, mentor])
    expect(placed.ordered_by).toBe(mentor)
  })

  it('lets only mentors and purchasers change Ordered by', async () => {
    const item = await ask(student)
    await setStatus(buyer, item.id, 'placed')
    await expect(db.as(student, 'update public.purchase_items set ordered_by = $2 where id = $1', [item.id, student])).rejects.toThrow(PERMISSION_DENIED)
    expect((await db.as<Item>(mentor, 'update public.purchase_items set ordered_by = $2 where id = $1 returning *', [item.id, mentor]))[0].ordered_by).toBe(mentor)
    expect((await db.as<Item>(buyer, 'update public.purchase_items set ordered_by = $2 where id = $1 returning *', [item.id, buyer]))[0].ordered_by).toBe(buyer)
  })

  it("doesn't let a student add an item with Ordered by filled in", async () => {
    await expect(
      db.as(student, "insert into public.purchase_items (name, vendor, type, quantity, ordered_by) values ('Belt', 'Amazon', 'Drive Base', 1, $1)", [mentor]),
    ).rejects.toThrow(PERMISSION_DENIED)
  })

  it('lets only mentors and purchasers set Shipped to', async () => {
    const item = await ask(student)
    await expect(db.as(student, 'update public.purchase_items set shipped_to = $2 where id = $1', [item.id, student])).rejects.toThrow(PERMISSION_DENIED)
    const [changed] = await db.as<Item>(buyer, 'update public.purchase_items set shipped_to = $2 where id = $1 returning *', [item.id, mentor])
    expect(changed.shipped_to).toBe(mentor)
  })

  it("stops a purchaser placing orders once they're removed, or their access is off", async () => {
    const item = await ask(student)
    await db.as(mentor, 'delete from public.purchasing_buyers where member_id = $1', [buyer])
    await expect(setStatus(buyer, item.id, 'placed')).rejects.toThrow(PERMISSION_DENIED)
    await db.as(mentor, 'insert into public.purchasing_buyers (member_id) values ($1)', [buyer])
    await db.switchOff(buyer)
    expect(await setStatus(buyer, item.id, 'placed')).toEqual([])
  })
})

describe('estimated arrival', () => {
  const setArrival = (person: string, id: string, date: string | null) =>
    db.as<Item>(person, 'update public.purchase_items set estimated_arrival = $2 where id = $1 returning *', [id, date])

  it('is set and changed by mentors and purchasers', async () => {
    const item = await ask(student)
    await setStatus(buyer, item.id, 'placed')
    expect((await setArrival(buyer, item.id, '2026-11-12'))[0].estimated_arrival).toBeTruthy()
    expect((await setArrival(mentor, item.id, null))[0].estimated_arrival).toBeNull()
  })

  it("can't be set or changed by a student", async () => {
    const item = await ask(student)
    await setStatus(buyer, item.id, 'placed')
    await expect(setArrival(student, item.id, '2026-11-12')).rejects.toThrow(PERMISSION_DENIED)
    await expect(
      db.as(student, "insert into public.purchase_items (name, vendor, type, quantity, estimated_arrival) values ('Belt', 'Amazon', 'Drive Base', 1, '2026-11-12')"),
    ).rejects.toThrow(PERMISSION_DENIED)
  })

  it("doesn't stop a purchaser changing other things about an order that has one", async () => {
    const item = await ask(student)
    await setStatus(buyer, item.id, 'placed')
    await setArrival(buyer, item.id, '2026-11-12')
    expect((await db.as<Item & { notes: string }>(buyer, "update public.purchase_items set notes = 'Two boxes' where id = $1 returning *", [item.id]))[0].notes).toBe('Two boxes')
  })
})

describe('prices', () => {
  const setPrice = (person: string, id: string, price: number | null) =>
    db.as<Item>(person, 'update public.purchase_items set price = $2 where id = $1 returning *', [id, price])

  const askAt = (person: string, price: number) =>
    db.as<Item>(person, "insert into public.purchase_items (name, vendor, type, quantity, price) values ('Belt', 'Amazon', 'Drive Base', 1, $1) returning *", [price])

  it('can be filled in by a student asking for something', async () => {
    const [item] = await askAt(student, 12.5)
    expect(Number(item.price)).toBe(12.5)
  })

  it('starts empty', async () => {
    expect((await ask(student)).price).toBeNull()
  })

  it('can be changed or emptied by a student until it is ordered', async () => {
    const item = await ask(mentor, 'wait')
    expect(Number((await setPrice(student, item.id, 8))[0].price)).toBe(8)
    expect((await setPrice(student, item.id, null))[0].price).toBeNull()
  })

  it('can be seen by everyone on the team', async () => {
    await askAt(mentor, 12.5)
    const [item] = await db.as<Item>(student, 'select price from public.purchase_items')
    expect(Number(item.price)).toBe(12.5)
  })

  it("can't be changed or emptied by a student once it's ordered", async () => {
    const [item] = await askAt(student, 12.5)
    for (const status of ['placed', 'backordered', 'received', 'in_shop', 'cancelled']) {
      await setStatus(buyer, item.id, status)
      await expect(setPrice(student, item.id, 1)).rejects.toThrow(PERMISSION_DENIED)
      await expect(setPrice(student, item.id, null)).rejects.toThrow(PERMISSION_DENIED)
    }
  })

  it('can be changed by mentors and purchasers once it is ordered', async () => {
    const [item] = await askAt(student, 12.5)
    await setStatus(buyer, item.id, 'placed')
    expect(Number((await setPrice(buyer, item.id, 13))[0].price)).toBe(13)
    expect(Number((await setPrice(mentor, item.id, 14))[0].price)).toBe(14)
  })

  it("stops working for a purchaser who's removed", async () => {
    const [item] = await askAt(student, 12.5)
    await setStatus(buyer, item.id, 'placed')
    await db.as(mentor, 'delete from public.purchasing_buyers where member_id = $1', [buyer])
    await expect(setPrice(buyer, item.id, 1)).rejects.toThrow(PERMISSION_DENIED)
  })

  it('locks the number needed at the same point, so a student can\'t change the total', async () => {
    const setQuantity = (person: string, id: string, quantity: number) =>
      db.as<Item & { quantity: number }>(person, 'update public.purchase_items set quantity = $2 where id = $1 returning *', [id, quantity])
    const [item] = await askAt(student, 12.5)
    expect((await setQuantity(student, item.id, 3))[0].quantity).toBe(3)
    await setStatus(buyer, item.id, 'placed')
    await expect(setQuantity(student, item.id, 5)).rejects.toThrow(PERMISSION_DENIED)
    expect((await setQuantity(buyer, item.id, 5))[0].quantity).toBe(5)
    expect((await setQuantity(mentor, item.id, 6))[0].quantity).toBe(6)
  })

  it('locks everything else about an order for a student too, but not for a purchaser', async () => {
    const [item] = await askAt(student, 12.5)
    const changes = [['name', 'Other'], ['vendor', 'Other'], ['type', 'Field'], ['link', 'https://example.com/other'], ['part_number', 'OTHER-1'], ['notes', 'Two boxes']]
    for (const [column, value] of changes) {
      expect(await db.as(student, `update public.purchase_items set ${column} = $2 where id = $1 returning id`, [item.id, value])).toHaveLength(1)
    }
    await setStatus(buyer, item.id, 'placed')
    for (const [column, value] of changes) {
      await expect(db.as(student, `update public.purchase_items set ${column} = $2 || ' again' where id = $1`, [item.id, value])).rejects.toThrow(PERMISSION_DENIED)
      expect(await db.as(buyer, `update public.purchase_items set ${column} = $2 || '-2' where id = $1 returning id`, [item.id, value])).toHaveLength(1)
    }
  })

  it('refuses a price under zero or over $99,999.99', async () => {
    await expect(askAt(student, -1)).rejects.toThrow('check constraint')
    await expect(askAt(student, 100000)).rejects.toThrow('numeric field overflow')
  })
})

describe('deleting', () => {
  it('lets a student delete something that is only being asked for', async () => {
    const item = await ask(student, 'order_low')
    expect(await db.as(student, 'delete from public.purchase_items where id = $1 returning id', [item.id])).toEqual([{ id: item.id }])
  })

  it("doesn't let a student delete an order, but lets a purchaser", async () => {
    const item = await ask(student)
    await setStatus(buyer, item.id, 'placed')
    expect(await db.as(student, 'delete from public.purchase_items where id = $1 returning id', [item.id])).toEqual([])
    expect(await db.as(buyer, 'delete from public.purchase_items where id = $1 returning id', [item.id])).toEqual([{ id: item.id }])
  })
})
