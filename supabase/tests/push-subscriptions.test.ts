// Permission rules for phone notifications (Web Push). A device's address
// works like a password for sending to it: people see and remove only their
// own, and add them only through save_push_subscription().
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

// Made up, in the shape browsers give: an https address and two base64url keys.
const P256DH = 'B' + 'A'.repeat(86)
const AUTH = 'k'.repeat(22)
const endpoint = (n = 1) => `https://push.example.com/send/device-${n}`

const save = (person: string | null, address = endpoint(), p256dh = P256DH, auth = AUTH) =>
  db.as(person, 'select public.save_push_subscription($1, $2, $3)', [address, p256dh, auth])

const mine = (person: string) =>
  db.as<{ member_id: string; endpoint: string }>(person, 'select member_id, endpoint from public.push_subscriptions order by endpoint')

describe('push subscriptions', () => {
  it('lets a member turn on notifications, saved as them', async () => {
    await save(student)
    expect(await mine(student)).toEqual([{ member_id: student, endpoint: endpoint() }])
  })

  it('keeps one row per device, however many times it is turned on', async () => {
    await save(student)
    await save(student)
    expect(await db.sql('select id from public.push_subscriptions')).toHaveLength(1)
  })

  it("shows people only their own devices, not even a mentor anyone else's", async () => {
    await save(student, endpoint(1))
    await save(other, endpoint(2))
    expect(await mine(student)).toEqual([{ member_id: student, endpoint: endpoint(1) }])
    expect(await mine(mentor)).toEqual([])
  })

  it('moves a shared device to whoever turned it on last', async () => {
    await save(student)
    await save(other)
    expect(await mine(student)).toEqual([])
    expect(await mine(other)).toEqual([{ member_id: other, endpoint: endpoint() }])
  })

  it("lets people remove their own devices, but not anyone else's", async () => {
    await save(student, endpoint(1))
    await save(other, endpoint(2))
    expect(await db.as(student, 'delete from public.push_subscriptions returning endpoint')).toEqual([{ endpoint: endpoint(1) }])
    expect(await db.as(mentor, 'delete from public.push_subscriptions returning endpoint')).toEqual([])
    expect(await db.sql('select id from public.push_subscriptions')).toHaveLength(1)
  })

  it("can't be added or changed directly, even by a mentor", async () => {
    await expect(
      db.as(mentor, 'insert into public.push_subscriptions (endpoint, p256dh, auth) values ($1, $2, $3)', [endpoint(), P256DH, AUTH]),
    ).rejects.toThrow(PERMISSION_DENIED)
    await save(student)
    await expect(db.as(student, 'update public.push_subscriptions set member_id = $1', [other])).rejects.toThrow(PERMISSION_DENIED)
  })

  it("can't be used by someone who isn't signed in, or whose access is off", async () => {
    await expect(save(null)).rejects.toThrow(PERMISSION_DENIED)
    await expect(db.as(null, 'select * from public.push_subscriptions')).rejects.toThrow(PERMISSION_DENIED)
    await save(student)
    await db.switchOff(student)
    await expect(save(student, endpoint(2))).rejects.toThrow(PERMISSION_DENIED)
    expect(await mine(student)).toEqual([])
  })

  it('refuses an address that is not https, and keys that are not a browser\'s', async () => {
    await expect(save(student, 'http://push.example.com/send/device-1')).rejects.toThrow('check constraint')
    await expect(save(student, endpoint(), 'not a key')).rejects.toThrow('check constraint')
    await expect(save(student, endpoint(), P256DH, 'short')).rejects.toThrow('check constraint')
  })

  it("keeps each person's 10 newest devices", async () => {
    for (let n = 1; n <= 12; n++) {
      await save(student, endpoint(n))
      await db.sql('update public.push_subscriptions set created_at = $1 where endpoint = $2', [new Date(Date.UTC(2026, 10, n)).toISOString(), endpoint(n)])
    }
    const kept = (await mine(student)).map((row) => row.endpoint)
    expect(kept).toHaveLength(10)
    expect(kept).not.toContain(endpoint(1))
    expect(kept).not.toContain(endpoint(2))
  })

  it('goes when the member is deleted', async () => {
    await save(student)
    await db.sql('delete from public.members where id = $1', [student])
    expect(await db.sql('select id from public.push_subscriptions')).toEqual([])
  })
})
