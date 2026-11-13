// Permission rules for turning off the BOM's daily Slack reminder
// (bom_reminder_opt_outs, issue #22). A row means "this person turned it
// off". People see, add and remove only their own row; nobody changes one;
// signed-out visitors and people whose access is off get nothing. The
// scheduled reminders read every row as the database owner.
import { beforeEach, describe, expect, it } from 'vitest'
import { tablesQuery } from '../../src/core/reminders'
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

const turnOff = (person: string | null, memberId?: string) =>
  memberId
    ? db.as(person, 'insert into public.bom_reminder_opt_outs (member_id) values ($1)', [memberId])
    : db.as(person, 'insert into public.bom_reminder_opt_outs default values')

const seen = (person: string) =>
  db.as<{ member_id: string }>(person, 'select member_id from public.bom_reminder_opt_outs')

describe('BOM reminder opt-outs', () => {
  it('let a member turn their own reminder off, saved as them, once', async () => {
    await turnOff(student)
    expect(await seen(student)).toEqual([{ member_id: student }])
    await expect(turnOff(student)).rejects.toThrow('duplicate key')
  })

  it("can't be added for someone else, even by a mentor", async () => {
    await expect(turnOff(student, other)).rejects.toThrow(PERMISSION_DENIED)
    await expect(turnOff(mentor, student)).rejects.toThrow(PERMISSION_DENIED)
  })

  it("show people only their own, not even a mentor anyone else's", async () => {
    await turnOff(student)
    await turnOff(other)
    expect(await seen(student)).toEqual([{ member_id: student }])
    expect(await seen(mentor)).toEqual([])
  })

  it("let people turn their own back on, but not anyone else's", async () => {
    await turnOff(student)
    await turnOff(other)
    expect(await db.as(mentor, 'delete from public.bom_reminder_opt_outs returning member_id')).toEqual([])
    expect(await db.as(student, 'delete from public.bom_reminder_opt_outs returning member_id')).toEqual([{ member_id: student }])
    expect(await db.sql('select member_id from public.bom_reminder_opt_outs')).toEqual([{ member_id: other }])
  })

  it("can't be changed, so a row can't be moved to someone else", async () => {
    await turnOff(student)
    await expect(db.as(student, 'update public.bom_reminder_opt_outs set member_id = $1', [other])).rejects.toThrow(PERMISSION_DENIED)
  })

  it("can't be used by someone who isn't signed in, or whose access is off", async () => {
    await turnOff(student)
    await expect(db.as(null, 'select * from public.bom_reminder_opt_outs')).rejects.toThrow(PERMISSION_DENIED)
    await expect(turnOff(null)).rejects.toThrow(PERMISSION_DENIED)
    await db.switchOff(student)
    expect(await seen(student)).toEqual([])
    await expect(db.as(student, 'delete from public.bom_reminder_opt_outs returning id')).resolves.toEqual([])
  })

  it('can all be read by the scheduled reminders', async () => {
    await turnOff(student)
    await turnOff(other)
    const results = await db.db.exec(tablesQuery(['bom_reminder_opt_outs']))
    const tables = results[1].rows[0].json_build_object as Record<string, { member_id: string }[]>
    expect(tables.bom_reminder_opt_outs.map((row) => row.member_id).sort()).toEqual([student, other].sort())
  })

  it('go when the member is deleted', async () => {
    await turnOff(student)
    await db.sql('delete from public.members where id = $1', [student])
    expect(await db.sql('select id from public.bom_reminder_opt_outs')).toEqual([])
  })
})
