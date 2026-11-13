// Permission rules for the Scouting module's match entries (#31): signed-in
// members read every entry and send their own; student leaders, mentors and
// admins change or delete them. Sending the same entry twice never makes two rows.
import { beforeEach, describe, expect, it } from 'vitest'
import { PERMISSION_DENIED, setUpTestDatabase } from './database'

const db = setUpTestDatabase()
let scout: string
let other: string
let mentor: string
let leader: string

beforeEach(async () => {
  scout = await db.member('Riley Park')
  other = await db.member('Casey Lee')
  mentor = await db.member('Pat Mentor', 'mentor')
  leader = await db.member('Casey Leader', 'leader')
})

interface Entry {
  id: string
  team_number: number
  created_by: string
  scouted_by: string | null
}

/** Send entries the way the app does: "on conflict do nothing", so an id already there is skipped. */
const send = (person: string, entries: { id: string; team?: number; match?: number; scoutedBy?: string }[]) =>
  db.as<Entry>(
    person,
    `insert into public.scouting_entries (id, event_key, match_number, team_number, counts, endgame, roles, broke_down, stop, driver_skill, scouted_by, scouted_at)
     select e.id, '2026test', e.match, e.team, '{"autoFuel": 3}', 'Level 2', '{Scorer}', false, 'None', 4, e.scouted_by, now()
     from jsonb_to_recordset($1) as e (id uuid, match int, team int, scouted_by uuid)
     on conflict (id) do nothing returning *`,
    [JSON.stringify(entries.map((e) => ({ id: e.id, match: e.match ?? 12, team: e.team ?? 9991, scouted_by: e.scoutedBy ?? person })))],
  )

describe('scouting entries', () => {
  it('lets a member send an entry, signed with their own id', async () => {
    const id = crypto.randomUUID()
    const [entry] = await send(scout, [{ id }])
    expect(entry).toMatchObject({ id, created_by: scout, scouted_by: scout })
  })

  it('skips an entry sent twice, so there is only one row', async () => {
    const id = crypto.randomUUID()
    await send(scout, [{ id }])
    expect(await send(scout, [{ id }, { id: crypto.randomUUID() }])).toHaveLength(1)
    expect(await db.sql('select id from public.scouting_entries where id = $1', [id])).toHaveLength(1)
  })

  it("doesn't let someone change another scout's entry by sending its id", async () => {
    const id = crypto.randomUUID()
    await send(scout, [{ id, team: 9991 }])
    expect(await send(other, [{ id, team: 1234 }])).toEqual([])
    expect(await db.sql('select team_number, created_by from public.scouting_entries')).toEqual([{ team_number: 9991, created_by: scout }])
  })

  it("lets a phone shared between scouts send someone else's entry, signed as the sender", async () => {
    const [entry] = await send(other, [{ id: crypto.randomUUID(), scoutedBy: scout }])
    expect(entry).toMatchObject({ created_by: other, scouted_by: scout })
  })

  it("doesn't let anyone send an entry as if someone else sent it", async () => {
    await expect(
      db.as(
        scout,
        `insert into public.scouting_entries (id, event_key, match_number, team_number, endgame, scouted_at, created_by)
         values ($1, '2026test', 12, 9991, 'None', now(), $2)`,
        [crypto.randomUUID(), other],
      ),
    ).rejects.toThrow(PERMISSION_DENIED)
  })

  it('lets every member read every entry', async () => {
    await send(scout, [{ id: crypto.randomUUID() }])
    await send(other, [{ id: crypto.randomUUID() }])
    expect(await db.as(scout, 'select id from public.scouting_entries')).toHaveLength(2)
  })

  it('can be changed and deleted by a mentor but not by a student', async () => {
    const [entry] = await send(scout, [{ id: crypto.randomUUID() }])
    expect(await db.as(scout, 'update public.scouting_entries set team_number = 1 where id = $1 returning id', [entry.id])).toEqual([])
    expect(await db.as(scout, 'delete from public.scouting_entries where id = $1 returning id', [entry.id])).toEqual([])
    expect(await db.as(mentor, 'update public.scouting_entries set team_number = 1 where id = $1 returning team_number', [entry.id])).toEqual([{ team_number: 1 }])
    expect(await db.as(mentor, 'delete from public.scouting_entries where id = $1 returning id', [entry.id])).toEqual([{ id: entry.id }])
  })

  it('lets a student leader change and delete an entry', async () => {
    const [entry] = await send(scout, [{ id: crypto.randomUUID() }])
    expect(await db.as(leader, 'update public.scouting_entries set team_number = 1234 where id = $1 returning team_number', [entry.id])).toEqual([{ team_number: 1234 }])
    expect(await db.as(leader, 'delete from public.scouting_entries where id = $1 returning id', [entry.id])).toEqual([{ id: entry.id }])
  })

  it('refuses a made-up stop and a driver skill outside 1 to 5', async () => {
    const insert = (column: string, value: unknown) =>
      db.as(scout, `insert into public.scouting_entries (id, event_key, match_number, team_number, endgame, scouted_at, ${column}) values ($1, '2026test', 1, 1, 'None', now(), $2)`, [crypto.randomUUID(), value])
    await expect(insert('stop', 'Brownout')).rejects.toThrow('check constraint')
    await expect(insert('driver_skill', 6)).rejects.toThrow('check constraint')
    expect(await insert('driver_skill', null)).toEqual([])
  })

  it('refuses a team or match number of 0, and counts that are not a list of counters', async () => {
    await expect(send(scout, [{ id: crypto.randomUUID(), team: 0 }])).rejects.toThrow('check constraint')
    await expect(send(scout, [{ id: crypto.randomUUID(), match: 0 }])).rejects.toThrow('check constraint')
    await expect(
      db.as(scout, "insert into public.scouting_entries (id, event_key, match_number, team_number, counts, endgame, scouted_at) values ($1, '2026test', 1, 1, '[1, 2]', 'None', now())", [crypto.randomUUID()]),
    ).rejects.toThrow('check constraint')
  })

  it("can't be read or sent by someone who isn't signed in", async () => {
    await send(scout, [{ id: crypto.randomUUID() }])
    await expect(db.as(null, 'select * from public.scouting_entries')).rejects.toThrow(PERMISSION_DENIED)
    await expect(
      db.as(null, "insert into public.scouting_entries (id, event_key, match_number, team_number, endgame, scouted_at) values ($1, '2026test', 1, 1, 'None', now())", [crypto.randomUUID()]),
    ).rejects.toThrow(PERMISSION_DENIED)
  })

  it("can't be read or sent by someone whose access is off", async () => {
    await send(other, [{ id: crypto.randomUUID() }])
    await db.switchOff(scout)
    expect(await db.as(scout, 'select * from public.scouting_entries')).toEqual([])
    await expect(send(scout, [{ id: crypto.randomUUID() }])).rejects.toThrow(PERMISSION_DENIED)
  })
})
