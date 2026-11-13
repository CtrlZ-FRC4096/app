// Notifications for purchase requests (step 5 of #93): when a request is
// ordered or arrives, whoever asked for it gets a notification in their
// bell. Nobody gets one for their own change, and people still can't add
// notifications for anyone else themselves. People who switched off
// Purchasing -> My requests on the Notifications page (#155) don't get them.
import { beforeEach, describe, expect, it } from 'vitest'
import { PERMISSION_DENIED, setUpTestDatabase } from './database'
import { purchasing } from '../../src/modules/purchasing'

const db = setUpTestDatabase()
let student: string
let other: string
let buyer: string
let mentor: string

beforeEach(async () => {
  student = await db.member('Riley Park')
  other = await db.member('Sam Ortiz')
  buyer = await db.member('Casey Lee')
  mentor = await db.member('Pat Mentor', 'mentor')
  await db.as(mentor, 'insert into public.purchasing_buyers (member_id) values ($1)', [buyer])
})

interface Notification {
  id: string
  member_id: string
  title: string
  body: string
  url: string | null
}

/** Someone asks for a belt. Returns the item's id. */
const ask = async (person: string) =>
  (await db.as<{ id: string }>(person, "insert into public.purchase_items (name, vendor, type, quantity) values ('Belt', 'Amazon', 'Drive Base', 2) returning id"))[0].id

const setStatus = (person: string, id: string, status: string) =>
  db.as(person, 'update public.purchase_items set status = $2 where id = $1', [id, status])

/** What someone sees in their bell. */
const bell = (person: string) =>
  db.as<Notification>(person, 'select id, member_id, title, body, url from public.notifications order by created_at')

/** Every notification for everyone, ignoring the rules. */
const allNotifications = () => db.sql<Notification>('select member_id, title from public.notifications order by created_at')

describe('purchase request notifications', () => {
  it('tell whoever asked for an item when it is ordered, and when it arrives', async () => {
    const item = await ask(student)
    await setStatus(buyer, item, 'placed')
    await setStatus(buyer, item, 'backordered')
    await setStatus(mentor, item, 'received')

    const url = `./#/purchasing/item/${item}`
    expect(await bell(student)).toMatchObject([
      { member_id: student, title: 'Your request was ordered', body: 'Belt', url },
      { member_id: student, title: 'Your request arrived', body: 'Belt', url },
    ])
    expect(await bell(buyer)).toEqual([])
    expect(await bell(mentor)).toEqual([])
  })

  it('can be read and deleted like any other notification', async () => {
    await setStatus(buyer, await ask(student), 'placed')
    const [notification] = await bell(student)
    expect(await db.as(student, 'update public.notifications set read_at = now() where id = $1 returning id', [notification.id])).toHaveLength(1)
    expect(await db.as(student, 'delete from public.notifications where id = $1 returning id', [notification.id])).toHaveLength(1)
  })

  it("aren't sent for any other status", async () => {
    const item = await ask(student)
    for (const status of ['order_high', 'out_of_stock', 'backordered', 'in_shop', 'cancelled']) {
      await setStatus(buyer, item, status)
    }
    expect(await allNotifications()).toEqual([])
  })

  it("aren't sent again when an ordered item is saved without changing its status", async () => {
    const item = await ask(student)
    await setStatus(buyer, item, 'placed')
    await setStatus(buyer, item, 'placed')
    await db.as(buyer, 'update public.purchase_items set price = 12.50 where id = $1', [item])
    expect(await allNotifications()).toHaveLength(1)
  })

  it("aren't sent for a change people made themselves", async () => {
    await setStatus(buyer, await ask(buyer), 'placed')
    await setStatus(mentor, await ask(mentor), 'received')
    expect(await allNotifications()).toEqual([])
  })

  it("aren't sent when nobody asked for the item any more", async () => {
    const item = await ask(student)
    // Like when the requester's account is deleted.
    await db.sql('update public.purchase_items set requested_by = null where id = $1', [item])
    await setStatus(buyer, item, 'placed')
    expect(await allNotifications()).toEqual([])
  })

  it('are sent for a change made in the SQL editor', async () => {
    const item = await ask(student)
    await db.sql("update public.purchase_items set status = 'received' where id = $1", [item])
    expect(await allNotifications()).toEqual([{ member_id: student, title: 'Your request arrived' }])
  })

  it('say which kind of notification they are', async () => {
    await setStatus(buyer, await ask(student), 'placed')
    expect(await db.sql('select topic from public.notifications')).toEqual([{ topic: 'purchasing.request_updates' }])
  })

  it('skip people who switched off Purchasing -> My requests, and only them', async () => {
    const choose = (person: string, enabled: boolean) =>
      db.as(person, "insert into public.notification_settings (key, enabled) values ('purchasing.request_updates', $1) on conflict (member_id, key) do update set enabled = excluded.enabled", [enabled])
    const mine = await ask(student)
    const theirs = await ask(other)

    await choose(student, false)
    await setStatus(buyer, mine, 'placed')
    await setStatus(buyer, theirs, 'placed')
    expect(await allNotifications()).toEqual([{ member_id: other, title: 'Your request was ordered' }])

    // Switching it back on sends the next one.
    await choose(student, true)
    await setStatus(buyer, mine, 'received')
    expect(await bell(student)).toMatchObject([{ title: 'Your request arrived' }])
  })

  it("are on for people who haven't chosen, like Purchasing's default", async () => {
    const [kind] = purchasing.notifications ?? []
    expect(kind).toMatchObject({ key: 'purchasing.request_updates', on: true })
    await setStatus(buyer, await ask(student), 'placed')
    expect(await bell(student)).toHaveLength(1)
  })

  it("can't be set off by a student, who can't place orders", async () => {
    const item = await ask(student)
    await expect(setStatus(other, item, 'placed')).rejects.toThrow(PERMISSION_DENIED)
    expect(await allNotifications()).toEqual([])
  })
})

describe('notifications for other people', () => {
  it("still can't be added by anyone directly, not even a purchaser", async () => {
    for (const [person, someoneElse] of [[other, student], [buyer, student], [mentor, student]]) {
      await expect(
        db.as(person, "insert into public.notifications (member_id, title, url) values ($1, 'Your request was ordered', './#/purchasing')", [someoneElse]),
      ).rejects.toThrow(PERMISSION_DENIED)
    }
    expect(await allNotifications()).toEqual([])
  })

  it("can't be added by running the database's own function", async () => {
    // Postgres only runs it when an item's status changes.
    await expect(db.as(student, 'select private.notify_purchase_requester()')).rejects.toThrow('can only be called as triggers')
    expect(await allNotifications()).toEqual([])
  })
})
