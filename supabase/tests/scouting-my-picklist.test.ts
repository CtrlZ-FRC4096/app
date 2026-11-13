// Permission rules for personal picklists (#151): everyone signed in reads
// every list and note; you add, change and remove only your own rows;
// mentors can remove anyone's; the database refuses a note over 500
// characters or a rank under 1.
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
  team_number: number
  rank: number
  note: string | null
  created_by: string
  created_at: string
  updated_at: string
}

const add = (person: string, team = 9991, rank = 1, note: string | null = null) =>
  db.as<Row>(person, "insert into public.scouting_my_picklist (event_key, team_number, rank, note) values ('2026test', $1, $2, $3) returning *", [team, rank, note])

describe('personal picklists', () => {
  it('lets a member add a team to their own list, signed with their own id', async () => {
    const [row] = await add(scout, 9991, 1, 'Great defender')
    expect(row).toMatchObject({ team_number: 9991, rank: 1, note: 'Great defender', created_by: scout })
  })

  it("lets every member read every list and note, for the team picklist", async () => {
    await add(scout, 9991)
    await add(other, 9992)
    expect(await db.as(scout, 'select team_number from public.scouting_my_picklist order by team_number')).toEqual([{ team_number: 9991 }, { team_number: 9992 }])
  })

  it("doesn't let anyone add a row to someone else's list", async () => {
    await expect(
      db.as(scout, "insert into public.scouting_my_picklist (event_key, team_number, rank, created_by) values ('2026test', 9991, 1, $1)", [other]),
    ).rejects.toThrow(PERMISSION_DENIED)
  })

  it('puts a team on each person’s list once per event, but on many people’s lists', async () => {
    await add(scout, 9991)
    await expect(add(scout, 9991, 2)).rejects.toThrow('duplicate key')
    expect(await add(other, 9991)).toHaveLength(1)
  })

  it('lets you change the rank and note on your own list, and keeps updated_at current', async () => {
    const [row] = await add(scout)
    const [changed] = await db.as<Row>(scout, "update public.scouting_my_picklist set rank = 3, note = 'Slow climb' where id = $1 returning *", [row.id])
    expect(changed).toMatchObject({ rank: 3, note: 'Slow climb' })
    expect(Date.parse(changed.updated_at)).toBeGreaterThanOrEqual(Date.parse(row.updated_at))
  })

  it("doesn't let anyone change someone else's list, even a mentor", async () => {
    const [row] = await add(scout)
    expect(await db.as(other, 'update public.scouting_my_picklist set rank = 5 where id = $1 returning id', [row.id])).toEqual([])
    expect(await db.as(mentor, 'update public.scouting_my_picklist set rank = 5 where id = $1 returning id', [row.id])).toEqual([])
  })

  it("only lets the rank and note change, so a row can't become another team, event or person", async () => {
    const [row] = await add(scout)
    for (const change of ['team_number = 1234', "event_key = '2026other'", `created_by = '${other}'`]) {
      await expect(db.as(scout, `update public.scouting_my_picklist set ${change} where id = $1`, [row.id]), change).rejects.toThrow(PERMISSION_DENIED)
    }
  })

  it("lets you remove your own rows, and mentors remove anyone's, but not other students", async () => {
    const [mine] = await add(scout, 9991)
    const [theirs] = await add(other, 9992)
    expect(await db.as(scout, 'delete from public.scouting_my_picklist where id = $1 returning id', [theirs.id])).toEqual([])
    expect(await db.as(scout, 'delete from public.scouting_my_picklist where id = $1 returning id', [mine.id])).toEqual([{ id: mine.id }])
    expect(await db.as(mentor, 'delete from public.scouting_my_picklist where id = $1 returning id', [theirs.id])).toEqual([{ id: theirs.id }])
  })

  it('refuses a note over 500 characters or empty, and a rank under 1', async () => {
    await expect(add(scout, 9991, 1, 'x'.repeat(501))).rejects.toThrow('check constraint')
    await expect(add(scout, 9991, 1, '')).rejects.toThrow('check constraint')
    await expect(add(scout, 9991, 0)).rejects.toThrow('check constraint')
    expect(await add(scout, 9991, 1, 'x'.repeat(500))).toHaveLength(1)
  })

  it("can't be read or changed by someone who isn't signed in, or whose access is off", async () => {
    await add(scout)
    await expect(db.as(null, 'select * from public.scouting_my_picklist')).rejects.toThrow(PERMISSION_DENIED)
    await db.switchOff(other)
    expect(await db.as(other, 'select * from public.scouting_my_picklist')).toEqual([])
    await expect(add(other)).rejects.toThrow(PERMISSION_DENIED)
  })
})
