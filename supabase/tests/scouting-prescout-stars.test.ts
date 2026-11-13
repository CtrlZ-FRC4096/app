// Permission rules for prescouting stars (#118): a star just for you is
// seen only by you; team stars are seen by everyone and need a reason; you
// add stars only as yourself and remove your own; mentors can also remove
// any team star.
import { beforeEach, describe, expect, it } from 'vitest'
import { PERMISSION_DENIED, setUpTestDatabase } from './database'

const db = setUpTestDatabase()
let scout: string
let other: string
let mentor: string

beforeEach(async () => {
  scout = await db.member('Riley Park')
  other = await db.member('Casey Lee')
  mentor = await db.member('Pat Mentor', 'mentor')
})

interface Star {
  id: string
  team_number: number
  for_team: boolean
  reason: string | null
  created_by: string
}

const star = (person: string, forTeam: boolean, reason: string | null = forTeam ? 'Fast, reliable auto' : null, team = 9991) =>
  db.as<Star>(person, "insert into public.scouting_prescout_stars (event_key, team_number, for_team, reason) values ('2026test', $1, $2, $3) returning *", [team, forTeam, reason])

const seenBy = async (person: string) => (await db.as<Star>(person, 'select * from public.scouting_prescout_stars order by created_at')).map((s) => [s.created_by === scout ? 'scout' : 'other', s.for_team])

describe('prescouting stars', () => {
  it('lets a member star a team, signed with their own id', async () => {
    const [row] = await star(scout, true)
    expect(row).toMatchObject({ team_number: 9991, for_team: true, reason: 'Fast, reliable auto', created_by: scout })
  })

  it('shows a star just for you only to you, and team stars to everyone', async () => {
    await star(scout, false)
    await star(scout, true)
    await star(other, false)
    expect(await seenBy(scout)).toEqual([['scout', false], ['scout', true]])
    expect(await seenBy(other)).toEqual([['scout', true], ['other', false]])
  })

  it("hides someone's own stars even from a mentor", async () => {
    await star(scout, false)
    expect(await db.as(mentor, 'select * from public.scouting_prescout_stars')).toEqual([])
  })

  it('refuses a team star with no reason, or an empty or too-long reason, but takes a star just for you with none', async () => {
    await expect(star(scout, true, null)).rejects.toThrow('check constraint')
    await expect(star(scout, true, '')).rejects.toThrow('check constraint')
    await expect(star(scout, true, 'x'.repeat(501))).rejects.toThrow('check constraint')
    expect(await star(scout, false, null)).toHaveLength(1)
  })

  it('lets several people star the same team for the whole team, but each person once of each kind', async () => {
    await star(scout, true)
    await star(other, true, 'Good second pick')
    await expect(star(scout, true, 'Again')).rejects.toThrow('duplicate key')
    expect(await star(scout, false)).toHaveLength(1)
  })

  it("doesn't let anyone star a team as someone else", async () => {
    await expect(
      db.as(scout, "insert into public.scouting_prescout_stars (event_key, team_number, for_team, reason, created_by) values ('2026test', 9991, true, 'Why', $1)", [other]),
    ).rejects.toThrow(PERMISSION_DENIED)
  })

  it("lets you remove your own stars, and mentors any team star, but not someone's star just for them", async () => {
    const [mine] = await star(scout, false)
    const [team] = await star(other, true)
    const [theirs] = await star(other, false)
    expect(await db.as(scout, 'delete from public.scouting_prescout_stars where id = $1 returning id', [team.id])).toEqual([])
    expect(await db.as(scout, 'delete from public.scouting_prescout_stars where id = $1 returning id', [mine.id])).toEqual([{ id: mine.id }])
    expect(await db.as(mentor, 'delete from public.scouting_prescout_stars where id = $1 returning id', [theirs.id])).toEqual([])
    expect(await db.as(mentor, 'delete from public.scouting_prescout_stars where id = $1 returning id', [team.id])).toEqual([{ id: team.id }])
  })

  it("can't be changed, only removed and added again", async () => {
    const [row] = await star(scout, true)
    await expect(db.as(scout, "update public.scouting_prescout_stars set reason = 'Changed' where id = $1", [row.id])).rejects.toThrow(PERMISSION_DENIED)
  })

  it("can't be read or added by someone who isn't signed in, or whose access is off", async () => {
    await star(scout, true)
    await expect(db.as(null, 'select * from public.scouting_prescout_stars')).rejects.toThrow(PERMISSION_DENIED)
    await db.switchOff(other)
    expect(await db.as(other, 'select * from public.scouting_prescout_stars')).toEqual([])
    await expect(star(other, false)).rejects.toThrow(PERMISSION_DENIED)
  })
})
