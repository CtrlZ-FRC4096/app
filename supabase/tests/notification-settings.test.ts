// Permission rules for choosing which notifications you get (#155): the
// "What to notify me about" switches on the Notifications page. People see
// and change only their own choices.
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

const KEY = 'purchasing.request_updates'

const choose = (person: string | null, enabled: boolean, key = KEY) =>
  db.as<{ id: string; member_id: string }>(person, 'insert into public.notification_settings (key, enabled) values ($1, $2) returning id, member_id', [key, enabled])

const mine = (person: string) => db.as<{ key: string; enabled: boolean }>(person, 'select key, enabled from public.notification_settings')

describe('notification settings', () => {
  it('let a member save a choice for themselves, once for each kind', async () => {
    const [row] = await choose(student, false)
    expect(row.member_id).toBe(student)
    expect(await mine(student)).toEqual([{ key: KEY, enabled: false }])
    await expect(choose(student, true)).rejects.toThrow('duplicate key')
  })

  it("don't let anyone save a choice for someone else, not even a mentor", async () => {
    await expect(
      db.as(mentor, 'insert into public.notification_settings (member_id, key, enabled) values ($1, $2, false)', [student, KEY]),
    ).rejects.toThrow(PERMISSION_DENIED)
  })

  it("show people only their own, not even a mentor anyone else's", async () => {
    await choose(student, false)
    expect(await mine(other)).toEqual([])
    expect(await mine(mentor)).toEqual([])
  })

  it('let people switch their own on and off, and change nothing else', async () => {
    const [row] = await choose(student, false)
    expect(await db.as(student, 'update public.notification_settings set enabled = true where id = $1 returning id', [row.id])).toHaveLength(1)
    await expect(db.as(student, "update public.notification_settings set key = 'purchasing.other' where id = $1", [row.id])).rejects.toThrow(PERMISSION_DENIED)
    await expect(db.as(student, 'update public.notification_settings set member_id = $2 where id = $1', [row.id, other])).rejects.toThrow(PERMISSION_DENIED)
  })

  it("don't let anyone change or delete someone else's", async () => {
    const [row] = await choose(student, false)
    expect(await db.as(mentor, 'update public.notification_settings set enabled = true where id = $1 returning id', [row.id])).toEqual([])
    expect(await db.as(mentor, 'delete from public.notification_settings where id = $1 returning id', [row.id])).toEqual([])
    expect(await db.as(student, 'delete from public.notification_settings where id = $1 returning id', [row.id])).toHaveLength(1)
  })

  it("are closed to someone who isn't signed in, or whose access is off", async () => {
    await expect(choose(null, false)).rejects.toThrow(PERMISSION_DENIED)
    await choose(student, false)
    await db.switchOff(student)
    expect(await mine(student)).toEqual([])
    await expect(choose(student, true, 'purchasing.other')).rejects.toThrow(PERMISSION_DENIED)
  })

  it('need a key like module.kind', async () => {
    for (const key of ['', 'purchasing', 'Purchasing.Updates', 'purchasing.request updates']) {
      await expect(choose(student, false, key), key).rejects.toThrow('check constraint')
    }
  })

  it("can't be read by anyone through wants_notification()", async () => {
    await expect(db.as(other, 'select private.wants_notification($1, $2, true)', [student, KEY])).rejects.toThrow(PERMISSION_DENIED)
  })
})
