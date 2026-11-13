// Permission rules for the Prescouting module's stars (#118): a star just
// for you is seen only by you; team stars are seen by every member and need
// a reason; members star as themselves; you remove your own stars, and
// mentors remove any team star.
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

interface StarRow {
  id: string
  team_number: number
  for_team: boolean
  reason: string
  created_by: string
}

const star = (person: string, forTeam: boolean, reason = '', team = 9991) =>
  db.as<StarRow>(
    person,
    "insert into public.prescouting_stars (event_key, team_number, for_team, reason) values ('2026test', $1, $2, $3) returning *",
    [team, forTeam, reason],
  )
const seenBy = async (person: string) => (await db.as<StarRow>(person, 'select * from public.prescouting_stars')).map((s) => s.id)

describe('prescouting stars', () => {
  it('lets a member star a team just for themselves, signed with their own id', async () => {
    const [row] = await star(student, false)
    expect(row).toMatchObject({ team_number: 9991, for_team: false, reason: '', created_by: student })
  })

  it('shows a star just for you only to you, not to other members or mentors', async () => {
    const [row] = await star(student, false)
    expect(await seenBy(student)).toEqual([row.id])
    expect(await seenBy(other)).toEqual([])
    expect(await seenBy(mentor)).toEqual([])
  })

  it('shows team stars to every signed-in member', async () => {
    const [row] = await star(student, true, 'Fast, reliable auto. Good second pick.')
    expect(await seenBy(other)).toEqual([row.id])
    expect(await seenBy(mentor)).toEqual([row.id])
  })

  it('refuses a team star with no reason, in the database', async () => {
    await expect(star(student, true, '')).rejects.toThrow('team_stars_need_a_reason')
    await expect(star(student, true, '   ')).rejects.toThrow('team_stars_need_a_reason')
  })

  it('lets several people star the same team for the whole team, each with their own reason', async () => {
    await star(student, true, 'Great auto')
    await star(other, true, 'Strong defense')
    expect(await seenBy(mentor)).toHaveLength(2)
  })

  it('keeps one star of each kind per person per team', async () => {
    await star(student, true, 'Great auto')
    await expect(star(student, true, 'Again')).rejects.toThrow('duplicate key')
    expect(await star(student, false)).toHaveLength(1)
  })

  it("doesn't let anyone star as someone else", async () => {
    await expect(
      db.as(student, "insert into public.prescouting_stars (event_key, team_number, for_team, reason, created_by) values ('2026test', 9991, true, 'Hi', $1)", [other]),
    ).rejects.toThrow(PERMISSION_DENIED)
  })

  it('lets you remove your own stars, but not other people\'s', async () => {
    const [mine] = await star(student, true, 'Great auto')
    const [theirs] = await star(other, true, 'Strong defense')
    expect(await db.as(student, 'delete from public.prescouting_stars where id = $1 returning id', [theirs.id])).toEqual([])
    expect(await db.as(student, 'delete from public.prescouting_stars where id = $1 returning id', [mine.id])).toEqual([{ id: mine.id }])
  })

  it("lets a mentor remove anyone's team star, but not a star just for someone", async () => {
    const [teamStar] = await star(student, true, 'Great auto')
    const [justMine] = await star(student, false)
    expect(await db.as(mentor, 'delete from public.prescouting_stars where id = $1 returning id', [teamStar.id])).toEqual([{ id: teamStar.id }])
    expect(await db.as(mentor, 'delete from public.prescouting_stars where id = $1 returning id', [justMine.id])).toEqual([])
  })

  it("can't be changed, even by whoever made it", async () => {
    const [row] = await star(student, true, 'Great auto')
    await expect(db.as(student, "update public.prescouting_stars set reason = 'Changed' where id = $1", [row.id])).rejects.toThrow(PERMISSION_DENIED)
  })

  it("can't be seen or added by someone who isn't signed in", async () => {
    await star(student, true, 'Great auto')
    await expect(db.as(null, 'select * from public.prescouting_stars')).rejects.toThrow(PERMISSION_DENIED)
    await expect(db.as(null, "insert into public.prescouting_stars (event_key, team_number, for_team, reason) values ('2026test', 9991, true, 'Hi')")).rejects.toThrow(PERMISSION_DENIED)
  })

  it("can't be seen or added by someone whose access is off", async () => {
    await star(student, true, 'Great auto')
    await db.switchOff(other)
    expect(await seenBy(other)).toEqual([])
    await expect(star(other, false)).rejects.toThrow(PERMISSION_DENIED)
  })
})

describe('prescouting notes after stars', () => {
  it("no longer have the old marked column: marks are team stars now", async () => {
    const columns = await db.sql<{ name: string }>(
      "select column_name as name from information_schema.columns where table_schema = 'public' and table_name = 'prescouting_notes'",
    )
    expect(columns.map((c) => c.name)).not.toContain('marked')
  })
})
