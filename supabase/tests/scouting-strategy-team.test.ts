// Permission rules for the scouting strategy team (#167): everyone signed in
// sees who's on it; only mentors and admins add and remove people. Being on
// it (or being a mentor or admin) is what private.is_strategy() checks, and
// the strategy-only tables' rules use that. Those tables' own tests check
// each one; this checks the team itself, and that scouts can still send
// their entries and read them back.
import { beforeEach, describe, expect, it } from 'vitest'
import { PERMISSION_DENIED, setUpTestDatabase } from './database'

const db = setUpTestDatabase()
let scout: string
let leader: string
let mentor: string

beforeEach(async () => {
  scout = await db.member('Riley Park')
  leader = await db.member('Casey Lee', 'leader')
  mentor = await db.member('Pat Mentor', 'mentor')
})

const isStrategy = async (person: string) => (await db.as<{ yes: boolean }>(person, 'select private.is_strategy() as yes'))[0].yes

describe('the strategy team', () => {
  it('lets a mentor add and remove people, and everyone see who is on it', async () => {
    const [row] = await db.as<{ id: string; member_id: string; created_by: string }>(mentor, 'insert into public.scouting_strategy_team (member_id) values ($1) returning *', [scout])
    expect(row).toMatchObject({ member_id: scout, created_by: mentor })
    expect(await db.as(leader, 'select member_id from public.scouting_strategy_team')).toEqual([{ member_id: scout }])
    expect(await db.as(mentor, 'delete from public.scouting_strategy_team where id = $1 returning id', [row.id])).toEqual([{ id: row.id }])
  })

  it("doesn't let a student or student leader add or remove people, even themselves", async () => {
    await expect(db.as(scout, 'insert into public.scouting_strategy_team (member_id) values ($1)', [scout])).rejects.toThrow(PERMISSION_DENIED)
    await expect(db.as(leader, 'insert into public.scouting_strategy_team (member_id) values ($1)', [scout])).rejects.toThrow(PERMISSION_DENIED)
    await db.strategy(scout)
    expect(await db.as(scout, 'delete from public.scouting_strategy_team returning id')).toEqual([])
  })

  it('counts mentors, admins and strategy members, but not other students or leaders, or anyone switched off', async () => {
    expect(await isStrategy(mentor)).toBe(true)
    expect(await isStrategy(await db.member('Sam Admin', 'admin'))).toBe(true)
    expect(await isStrategy(scout)).toBe(false)
    expect(await isStrategy(leader)).toBe(false)
    await db.strategy(scout)
    expect(await isStrategy(scout)).toBe(true)
    await db.switchOff(scout)
    expect(await isStrategy(scout)).toBe(false)
  })

  it("can't be read by someone who isn't signed in", async () => {
    await expect(db.as(null, 'select * from public.scouting_strategy_team')).rejects.toThrow(PERMISSION_DENIED)
  })

  it('still lets a scout off the strategy team send match and pit entries, and read them back', async () => {
    const id = crypto.randomUUID()
    await db.as(scout, "insert into public.scouting_entries (id, event_key, match_number, team_number, endgame, scouted_by, scouted_at) values ($1, '2026test', 1, 9991, 'None', $2, now()) on conflict (id) do nothing", [id, scout])
    await db.as(scout, "insert into public.scouting_pit_entries (id, event_key, team_number, scouted_by, scouted_at) values ($1, '2026test', 9991, $2, now()) on conflict (id) do nothing", [id, scout])
    expect(await db.as(scout, 'select id from public.scouting_entries')).toEqual([{ id }])
    expect(await db.as(scout, 'select id from public.scouting_pit_entries')).toEqual([{ id }])
  })
})
