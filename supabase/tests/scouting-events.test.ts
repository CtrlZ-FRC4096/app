// Permission rules for the event the team is scouting: signed-in members
// see it; only mentors and admins pick it; nobody changes or deletes a pick.
import { beforeEach, describe, expect, it } from 'vitest'
import { PERMISSION_DENIED, setUpTestDatabase } from './database'

const db = setUpTestDatabase()
let student: string
let leader: string
let mentor: string
let admin: string

beforeEach(async () => {
  student = await db.member('Riley Park')
  leader = await db.member('Casey Lee', 'leader')
  mentor = await db.member('Pat Mentor', 'mentor')
  admin = await db.member('Sam Admin', 'admin')
})

interface Pick {
  id: string
  event_key: string
  name: string
  created_by: string
}

/** Pick an event, the way the app does. */
const pick = (person: string, event = '2026test', name = 'Test Regional') =>
  db.as<Pick>(person, 'insert into public.scouting_events (event_key, name) values ($1, $2) returning *', [event, name])

describe('the event the team is scouting', () => {
  it('lets a mentor and an admin pick it, signed with their own id', async () => {
    const [first] = await pick(mentor)
    const [second] = await pick(admin, '2026test2', 'Test District Event')
    expect(first).toMatchObject({ event_key: '2026test', name: 'Test Regional', created_by: mentor })
    expect(second).toMatchObject({ event_key: '2026test2', created_by: admin })
  })

  it("doesn't let a student or a student leader pick it", async () => {
    await expect(pick(student)).rejects.toThrow(PERMISSION_DENIED)
    await expect(pick(leader)).rejects.toThrow(PERMISSION_DENIED)
  })

  it("doesn't let anyone pick it as if someone else did", async () => {
    await expect(
      db.as(mentor, "insert into public.scouting_events (event_key, name, created_by) values ('2026test', 'Test Regional', $1)", [admin]),
    ).rejects.toThrow(PERMISSION_DENIED)
  })

  it('lets every member see every pick, newest first', async () => {
    await pick(mentor, '2026one', 'First Event')
    await pick(mentor, '2026two', 'Second Event')
    const rows = await db.as<{ event_key: string }>(student, 'select event_key from public.scouting_events order by created_at desc, event_key desc')
    expect(rows.map((r) => r.event_key)).toEqual(['2026two', '2026one'])
  })

  it("doesn't let anyone change or delete a pick, not even an admin", async () => {
    const [row] = await pick(mentor)
    await expect(db.as(admin, "update public.scouting_events set event_key = '2026other' where id = $1", [row.id])).rejects.toThrow(PERMISSION_DENIED)
    await expect(db.as(admin, 'delete from public.scouting_events where id = $1', [row.id])).rejects.toThrow(PERMISSION_DENIED)
  })

  it("refuses something that isn't an event key, and a blank name", async () => {
    await expect(pick(mentor, '../../account')).rejects.toThrow()
    await expect(pick(mentor, '2026ILCH')).rejects.toThrow()
    await expect(pick(mentor, '2026test', '')).rejects.toThrow()
  })
})
