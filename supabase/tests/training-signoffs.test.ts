// Permission rules for the Training module's hands-on skill sign-offs. One
// test for each thing the rules should allow or stop.
//
//                                         Students   Mentors and admins
//   See sign-offs                         their own  everyone's
//   Ask for a sign-off (for themselves)   yes        yes
//   Cancel their own waiting request      yes        yes
//   Sign anyone off, or change a row      no         yes
//   Turn down a request, or take back     no         yes
//
// Student leaders are students here: only mentors and admins sign off.
import { beforeEach, describe, expect, it } from 'vitest'
import { PERMISSION_DENIED, setUpTestDatabase } from './database'

const db = setUpTestDatabase()
let student: string
let otherStudent: string
let leader: string
let mentor: string
let admin: string

beforeEach(async () => {
  student = await db.member('Riley Park')
  otherStudent = await db.member('Casey Lee')
  leader = await db.member('Jamie Leader', 'leader')
  mentor = await db.member('Pat Mentor', 'mentor')
  admin = await db.member('Morgan Admin', 'admin')
})

interface SignOffRow {
  id: string
  skill_id: string
  status: string
  created_by: string
  signed_off_by: string | null
  signed_off_at: string | null
}

const ask = (person: string, skill = 'drill-press') =>
  db.as<SignOffRow>(person, 'insert into public.training_signoffs (skill_id) values ($1) returning *', [skill])

const signOff = (person: string, id: string) =>
  db.as<SignOffRow>(person, "update public.training_signoffs set status = 'signed_off' where id = $1 returning *", [id])

/** The row as it really is, with no rules applied, or undefined if it's gone. */
const rowNow = async (id: string) => (await db.sql<SignOffRow>('select * from public.training_signoffs where id = $1', [id]))[0]

describe('asking for a sign-off', () => {
  it('lets a member ask for themselves, and it starts as a request', async () => {
    const [row] = await ask(student)
    expect(row).toMatchObject({ created_by: student, status: 'requested', signed_off_by: null, signed_off_at: null })
  })

  it("doesn't let anyone ask for someone else", async () => {
    await expect(
      db.as(student, 'insert into public.training_signoffs (skill_id, created_by) values ($1, $2)', ['drill-press', otherStudent]),
    ).rejects.toThrow(PERMISSION_DENIED)
  })

  it('refuses the same skill twice for one person, but not for two people', async () => {
    await ask(student)
    await expect(ask(student)).rejects.toThrow('unique constraint')
    await ask(otherStudent)
  })

  it("shows students their own sign-offs only, and mentors everyone's", async () => {
    await ask(student)
    await ask(otherStudent, 'soldering')
    expect(await db.as(student, 'select skill_id from public.training_signoffs')).toEqual([{ skill_id: 'drill-press' }])
    expect(await db.as(mentor, 'select skill_id from public.training_signoffs order by skill_id')).toEqual([
      { skill_id: 'drill-press' },
      { skill_id: 'soldering' },
    ])
  })

  it("lets a member cancel their own waiting request, but not anyone else's, and not once it's signed off", async () => {
    const [mine] = await ask(student)
    const [theirs] = await ask(otherStudent)
    const [signedOff] = await ask(student, 'soldering')
    await signOff(mentor, signedOff.id)
    expect(await db.as(student, 'delete from public.training_signoffs where id = $1 returning id', [theirs.id])).toEqual([])
    expect(await db.as(student, 'delete from public.training_signoffs where id = $1 returning id', [signedOff.id])).toEqual([])
    expect(await db.as(student, 'delete from public.training_signoffs where id = $1 returning id', [mine.id])).toEqual([{ id: mine.id }])
  })

  it("can't be read or added by someone who isn't signed in", async () => {
    await ask(student)
    await expect(db.as(null, 'select * from public.training_signoffs')).rejects.toThrow(PERMISSION_DENIED)
    await expect(db.as(null, "insert into public.training_signoffs (skill_id) values ('drill-press')")).rejects.toThrow(PERMISSION_DENIED)
  })

  it("can't be read or added by someone whose access is off", async () => {
    await ask(student)
    await db.switchOff(student)
    expect(await db.as(student, 'select * from public.training_signoffs')).toEqual([])
    await expect(ask(student, 'soldering')).rejects.toThrow(PERMISSION_DENIED)
  })
})

describe('signing off', () => {
  it('never lets a student or student leader sign anyone off, themselves included', async () => {
    for (const person of [student, leader]) {
      // Adding a row that's already signed off, for themselves or someone else.
      await expect(
        db.as(person, "insert into public.training_signoffs (skill_id, status) values ('band-saw', 'signed_off')"),
      ).rejects.toThrow(PERMISSION_DENIED)
      await expect(
        db.as(person, "insert into public.training_signoffs (skill_id, created_by, status) values ('band-saw', $1, 'signed_off')", [otherStudent]),
      ).rejects.toThrow(PERMISSION_DENIED)
      // Changing their own request to signed off: refused or ignored, and the row stays a request.
      const [request] = await ask(person)
      await signOff(person, request.id).catch(() => [])
      expect((await rowNow(request.id)).status).toBe('requested')
    }
  })

  it('lets a mentor or admin sign off a request, and records who did it and when', async () => {
    for (const [person, signer] of [[student, mentor], [otherStudent, admin]]) {
      const [request] = await ask(person)
      const [row] = await signOff(signer, request.id)
      expect(row).toMatchObject({ status: 'signed_off', signed_off_by: signer })
      expect(row.signed_off_at).not.toBeNull()
    }
  })

  it('lets a mentor sign people off without a request', async () => {
    const rows = await db.as<SignOffRow>(
      mentor,
      "insert into public.training_signoffs (skill_id, created_by, status) values ('shop-safety', $1, 'signed_off'), ('shop-safety', $2, 'signed_off') returning *",
      [student, otherStudent],
    )
    expect(rows.map((row) => [row.created_by, row.signed_off_by])).toEqual([[student, mentor], [otherStudent, mentor]])
  })

  it("doesn't let anyone fake who signed off or when", async () => {
    const [request] = await ask(student)
    await expect(
      db.as(mentor, 'update public.training_signoffs set signed_off_by = $2 where id = $1', [request.id, admin]),
    ).rejects.toThrow(PERMISSION_DENIED)
    await expect(
      db.as(mentor, "insert into public.training_signoffs (skill_id, created_by, status, signed_off_at) values ('band-saw', $1, 'signed_off', '2020-01-01')", [student]),
    ).rejects.toThrow(PERMISSION_DENIED)
    // Signing off again later keeps the first mentor and time.
    const [first] = await signOff(mentor, request.id)
    const [again] = await signOff(admin, request.id)
    expect(again).toMatchObject({ signed_off_by: mentor, signed_off_at: first.signed_off_at })
  })

  it('lets a mentor turn down a request or take back a sign-off', async () => {
    const [request] = await ask(student)
    const [signedOff] = await ask(otherStudent)
    await signOff(mentor, signedOff.id)
    expect(await db.as(mentor, 'delete from public.training_signoffs where id = $1 returning id', [request.id])).toEqual([{ id: request.id }])
    expect(await db.as(mentor, 'delete from public.training_signoffs where id = $1 returning id', [signedOff.id])).toEqual([{ id: signedOff.id }])
  })
})
