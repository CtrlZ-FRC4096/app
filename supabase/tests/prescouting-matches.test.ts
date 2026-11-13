// Permission rules for scouting a team's matches from video (#153): every
// signed-in member reads every row; you add rows only as yourself and
// change or remove your own; mentors can remove anyone's. Also the overall
// summary added to prescouting_notes.
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

interface Row {
  id: string
  match_key: string
  notes: string
  created_by: string
  updated_at: string
}

const add = (person: string, { match = '2026test_qm1', notes = 'Fast cycles', team = 9991 } = {}) =>
  db.as<Row>(
    person,
    `insert into public.prescouting_matches (team_number, event_key, match_key, counts, endgame, roles, notes)
     values ($1, '2026test', $2, '{"autoFuel": 3}', 'Level 2', '{Scorer}', $3) returning *`,
    [team, match, notes],
  )

describe('prescouted matches', () => {
  it('lets a member scout a match, signed with their own id', async () => {
    const [row] = await add(scout)
    expect(row).toMatchObject({ match_key: '2026test_qm1', notes: 'Fast cycles', created_by: scout })
  })

  it('lets several people scout the same match, but each scout a team once in it', async () => {
    await add(scout)
    expect(await add(other)).toHaveLength(1)
    await expect(add(scout)).rejects.toThrow('duplicate key')
    expect(await add(scout, { match: '2026test_qm2' })).toHaveLength(1)
  })

  it('lets every member read every row', async () => {
    await add(scout)
    await add(other, { match: '2026test_qm2' })
    expect(await db.as(scout, 'select match_key from public.prescouting_matches order by match_key')).toEqual([{ match_key: '2026test_qm1' }, { match_key: '2026test_qm2' }])
  })

  it("doesn't let anyone add a row as someone else", async () => {
    await expect(
      db.as(scout, "insert into public.prescouting_matches (team_number, event_key, match_key, endgame, created_by) values (9991, '2026test', '2026test_qm1', 'None', $1)", [other]),
    ).rejects.toThrow(PERMISSION_DENIED)
  })

  it('lets you change your own row, keeping updated_at current, but not anyone else’s, even as a mentor', async () => {
    const [row] = await add(scout)
    const [changed] = await db.as<Row>(scout, "update public.prescouting_matches set notes = 'Changed' where id = $1 returning *", [row.id])
    expect(changed.notes).toBe('Changed')
    expect(Date.parse(changed.updated_at)).toBeGreaterThanOrEqual(Date.parse(row.updated_at))
    expect(await db.as(other, "update public.prescouting_matches set notes = 'No' where id = $1 returning id", [row.id])).toEqual([])
    expect(await db.as(mentor, "update public.prescouting_matches set notes = 'No' where id = $1 returning id", [row.id])).toEqual([])
  })

  it("only lets what was seen change, not the team, match or scout", async () => {
    const [row] = await add(scout)
    for (const change of ['team_number = 1234', "match_key = '2026test_qm9'", `created_by = '${other}'`]) {
      await expect(db.as(scout, `update public.prescouting_matches set ${change} where id = $1`, [row.id]), change).rejects.toThrow(PERMISSION_DENIED)
    }
  })

  it("lets you remove your own rows, and mentors anyone's, but not other students", async () => {
    const [mine] = await add(scout)
    const [theirs] = await add(other, { match: '2026test_qm2' })
    expect(await db.as(scout, 'delete from public.prescouting_matches where id = $1 returning id', [theirs.id])).toEqual([])
    expect(await db.as(scout, 'delete from public.prescouting_matches where id = $1 returning id', [mine.id])).toEqual([{ id: mine.id }])
    expect(await db.as(mentor, 'delete from public.prescouting_matches where id = $1 returning id', [theirs.id])).toEqual([{ id: theirs.id }])
  })

  it("refuses notes over 2,000 characters, and a match from another event", async () => {
    await expect(add(scout, { notes: 'x'.repeat(2001) })).rejects.toThrow('check constraint')
    await expect(add(scout, { match: '2026other_qm1' })).rejects.toThrow('check constraint')
    expect(await add(scout, { notes: 'x'.repeat(2000) })).toHaveLength(1)
  })

  it("can't be read or added by someone who isn't signed in, or whose access is off", async () => {
    await add(scout)
    await expect(db.as(null, 'select * from public.prescouting_matches')).rejects.toThrow(PERMISSION_DENIED)
    await db.switchOff(other)
    expect(await db.as(other, 'select * from public.prescouting_matches')).toEqual([])
    await expect(add(other, { match: '2026test_qm3' })).rejects.toThrow(PERMISSION_DENIED)
  })
})

describe("prescouting notes' overall summary", () => {
  it('starts empty, can be changed by any member, and refuses over 2,000 characters', async () => {
    const [row] = await db.as<{ id: string; overall: string }>(scout, "insert into public.prescouting_notes (event_key, team_number) values ('2026test', 9991) returning id, overall")
    expect(row.overall).toBe('')
    expect(await db.as(other, "update public.prescouting_notes set overall = 'Good second pick' where id = $1 returning overall", [row.id])).toEqual([{ overall: 'Good second pick' }])
    await expect(db.as(other, 'update public.prescouting_notes set overall = $2 where id = $1', [row.id, 'x'.repeat(2001)])).rejects.toThrow('check constraint')
  })
})
