// Permission rules for the Scouting module's pit entries (#35), based on the
// tests in #114: signed-in members read every pit entry and send their own;
// only mentors change or delete them. Every visit to a team is kept, and
// sending the same entry twice never makes two rows.
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

interface PitRow {
  id: string
  team_number: number
  weight: string | null
  created_by: string
  scouted_by: string | null
}

/** Send pit entries the way the app does: "on conflict do nothing", so an id already there is skipped. */
const send = (person: string, entries: { id?: string; team?: number; weight?: number | null; scoutedBy?: string }[]) =>
  db.as<PitRow>(
    person,
    `insert into public.scouting_pit_entries (id, event_key, team_number, drivetrain, weight, motors, scouted_by, scouted_at)
     select e.id, '2026test', e.team, 'Swerve', e.weight, '8 Kraken X60', e.scouted_by, now()
     from jsonb_to_recordset($1) as e (id uuid, team int, weight numeric, scouted_by uuid)
     on conflict (id) do nothing returning *`,
    [JSON.stringify(entries.map((e) => ({ id: e.id ?? crypto.randomUUID(), team: e.team ?? 9991, weight: e.weight === undefined ? 115.5 : e.weight, scouted_by: e.scoutedBy ?? person })))],
  )

describe('scouting pit entries', () => {
  it('lets a member send a pit entry, signed with their own id', async () => {
    const [entry] = await send(scout, [{}])
    expect(entry).toMatchObject({ created_by: scout, scouted_by: scout, team_number: 9991 })
  })

  it('keeps every visit to the same team', async () => {
    await send(scout, [{ team: 9991 }])
    await send(other, [{ team: 9991 }])
    expect(await db.as(scout, 'select id from public.scouting_pit_entries')).toHaveLength(2)
  })

  it('skips a pit entry sent twice, so there is only one row', async () => {
    const id = crypto.randomUUID()
    await send(scout, [{ id }])
    expect(await send(scout, [{ id }])).toEqual([])
    expect(await db.sql('select id from public.scouting_pit_entries')).toHaveLength(1)
  })

  it("doesn't let someone change another scout's entry by sending its id", async () => {
    const id = crypto.randomUUID()
    await send(scout, [{ id, team: 9991 }])
    expect(await send(other, [{ id, team: 1234 }])).toEqual([])
    expect(await db.sql('select team_number, created_by from public.scouting_pit_entries')).toEqual([{ team_number: 9991, created_by: scout }])
  })

  it("doesn't let anyone send a pit entry as if someone else sent it", async () => {
    await expect(
      db.as(scout, "insert into public.scouting_pit_entries (id, event_key, team_number, scouted_at, created_by) values ($1, '2026test', 9991, now(), $2)", [crypto.randomUUID(), other]),
    ).rejects.toThrow(PERMISSION_DENIED)
  })

  it('lets every member read every pit entry', async () => {
    await send(scout, [{ team: 9991 }])
    await send(other, [{ team: 9992 }])
    expect(await db.as(scout, 'select team_number from public.scouting_pit_entries order by team_number')).toEqual([{ team_number: 9991 }, { team_number: 9992 }])
  })

  it('takes an entry with only a team number', async () => {
    expect(
      await db.as(scout, "insert into public.scouting_pit_entries (id, event_key, team_number, scouted_at) values ($1, '2026test', 9991, now()) returning team_number", [crypto.randomUUID()]),
    ).toEqual([{ team_number: 9991 }])
  })

  // #163: the questions added later. A pit entry from an older phone leaves them out.
  it('takes a typed Other drivetrain and what the robot can see, and leaves them empty for an older entry', async () => {
    const [full] = await db.as<Record<string, unknown>>(
      scout,
      `insert into public.scouting_pit_entries (id, event_key, team_number, drivetrain, drivetrain_other, vision, vision_notes, scouted_at)
       values ($1, '2026test', 9991, 'Other', 'West coast', '{AprilTags}', 'Two cameras', now()) returning *`,
      [crypto.randomUUID()],
    )
    expect(full).toMatchObject({ drivetrain_other: 'West coast', vision: ['AprilTags'], vision_notes: 'Two cameras' })
    const [older] = await send(scout, [{}])
    expect(older).toMatchObject({ drivetrain_other: null, vision: [], vision_notes: null })
  })

  it('refuses a typed drivetrain or vision answer that is empty or too long, like the form', async () => {
    const insert = (column: string, value: string) =>
      db.as(scout, `insert into public.scouting_pit_entries (id, event_key, team_number, scouted_at, ${column}) values ($1, '2026test', 9991, now(), $2)`, [crypto.randomUUID(), value])
    for (const [column, longest] of [['drivetrain_other', 100], ['vision_notes', 300]] as const) {
      await expect(insert(column, ''), column).rejects.toThrow('check constraint')
      await expect(insert(column, 'x'.repeat(longest + 1)), column).rejects.toThrow('check constraint')
      expect(await insert(column, 'x'.repeat(longest)), column).toEqual([])
    }
  })

  it('refuses no team, a weight or size of 0 or less, and empty text instead of nothing', async () => {
    await expect(send(scout, [{ team: 0 }])).rejects.toThrow('check constraint')
    await expect(send(scout, [{ weight: 0 }])).rejects.toThrow('check constraint')
    await expect(
      db.as(scout, "insert into public.scouting_pit_entries (id, event_key, team_number, height, scouted_at) values ($1, '2026test', 9991, -2, now())", [crypto.randomUUID()]),
    ).rejects.toThrow('check constraint')
    await expect(
      db.as(scout, "insert into public.scouting_pit_entries (id, event_key, team_number, motors, scouted_at) values ($1, '2026test', 9991, '', now())", [crypto.randomUUID()]),
    ).rejects.toThrow('check constraint')
  })

  it('can be changed or deleted by a mentor, but not by a student, even their own', async () => {
    const [entry] = await send(scout, [{}])
    expect(await db.as(scout, "update public.scouting_pit_entries set motors = 'Changed' where id = $1 returning id", [entry.id])).toEqual([])
    expect(await db.as(scout, 'delete from public.scouting_pit_entries where id = $1 returning id', [entry.id])).toEqual([])
    expect(await db.as(mentor, "update public.scouting_pit_entries set motors = 'Changed' where id = $1 returning motors", [entry.id])).toEqual([{ motors: 'Changed' }])
    expect(await db.as(mentor, 'delete from public.scouting_pit_entries where id = $1 returning id', [entry.id])).toEqual([{ id: entry.id }])
  })

  it("can't be read or sent by someone who isn't signed in", async () => {
    await send(scout, [{}])
    await expect(db.as(null, 'select * from public.scouting_pit_entries')).rejects.toThrow(PERMISSION_DENIED)
    await expect(
      db.as(null, "insert into public.scouting_pit_entries (id, event_key, team_number, scouted_at) values ($1, '2026test', 9991, now())", [crypto.randomUUID()]),
    ).rejects.toThrow(PERMISSION_DENIED)
  })

  it("can't be read or sent by someone whose access is off", async () => {
    await send(other, [{}])
    await db.switchOff(scout)
    expect(await db.as(scout, 'select * from public.scouting_pit_entries')).toEqual([])
    await expect(send(scout, [{}])).rejects.toThrow(PERMISSION_DENIED)
  })
})
