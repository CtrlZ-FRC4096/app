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

  it('lets the strategy team and mentors read every entry, and anyone else only the ones they scouted or sent (#167)', async () => {
    await send(scout, [{ id: crypto.randomUUID() }])
    await send(other, [{ id: crypto.randomUUID() }])
    // A phone shared between scouts: sent by other, scouted by scout.
    await send(other, [{ id: crypto.randomUUID(), scoutedBy: scout }])
    expect(await db.as(scout, 'select id from public.scouting_entries')).toHaveLength(2)
    expect(await db.as(other, 'select id from public.scouting_entries')).toHaveLength(2)
    expect(await db.as(mentor, 'select id from public.scouting_entries')).toHaveLength(3)
    await db.strategy(scout)
    expect(await db.as(scout, 'select id from public.scouting_entries')).toHaveLength(3)
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

  // #162: the questions added later. An entry from an older phone leaves them out.
  it('takes both stops, what broke, a brownout, the auto and ranking points, and leaves them empty for an older entry', async () => {
    const insert = (columns: string, values: unknown[]) =>
      db.as<Record<string, unknown>>(
        scout,
        `insert into public.scouting_entries (id, event_key, match_number, team_number, endgame, scouted_at${columns ? `, ${columns}` : ''})
         values ($1, '2026test', 1, 1, 'None', now()${values.map((_, i) => `, $${i + 2}`).join('')}) returning *`,
        [crypto.randomUUID(), ...values],
      )
    const [full] = await insert('stop, role_notes, broke_down, broke_parts, broke_other, browned_out, auto_side, auto_notes, ranking_points', [
      'Both', 'Fast cycles', true, ['Intake', 'Climber'], 'Bumper fell off', true, 'Left', 'Scored preload', ['Energized'],
    ])
    expect(full).toMatchObject({ stop: 'Both', broke_parts: ['Intake', 'Climber'], browned_out: true, ranking_points: ['Energized'] })
    const [older] = await insert('', [])
    expect(older).toMatchObject({ role_notes: null, broke_parts: [], broke_other: null, browned_out: false, auto_side: null, auto_notes: null, ranking_points: [] })
  })

  // #185: died is its own answer, separate from a brownout. An entry from an older phone leaves it out.
  it('keeps died apart from a brownout, and leaves it "no" for an older entry', async () => {
    const insert = (columns: string, values: unknown[]) =>
      db.as<Record<string, unknown>>(
        scout,
        `insert into public.scouting_entries (id, event_key, match_number, team_number, endgame, scouted_at, ${columns})
         values ($1, '2026test', 1, 1, 'None', now()${values.map((_, i) => `, $${i + 2}`).join('')}) returning *`,
        [crypto.randomUUID(), ...values],
      )
    const [died] = await insert('died, browned_out', [true, false])
    expect(died).toMatchObject({ died: true, browned_out: false })
    const [older] = await insert('browned_out', [true])
    expect(older).toMatchObject({ died: false, browned_out: true })
  })

  // #205: the auto path drawn on the field. An entry from an older phone has none.
  describe('auto path', () => {
    const insert = (path: unknown) =>
      db.as<{ auto_path: unknown }>(
        scout,
        `insert into public.scouting_entries (id, event_key, match_number, team_number, endgame, scouted_at, auto_path)
         values ($1, '2026test', 1, 1, 'None', now(), $2) returning auto_path`,
        [crypto.randomUUID(), path === undefined ? null : JSON.stringify(path)],
      )
    const line = (spots: number) => Array.from({ length: spots }, (_, i) => [i / spots, 0.5])
    const drove = { strokes: [[[0.25, 0.5], [0.1, 0.25]]], marks: [{ type: 'shot', x: 0.25, y: 0.5 }], didnt_move: false }

    it("keeps a drawn path or a Didn't move, and leaves an older entry's empty", async () => {
      expect(await insert(drove)).toEqual([{ auto_path: drove }])
      const still = { strokes: [], marks: [{ type: 'shot', x: 0.25, y: 0.5 }], didnt_move: true }
      expect(await insert(still)).toEqual([{ auto_path: still }])
      expect(await insert(undefined)).toEqual([{ auto_path: null }])
      // The biggest the form allows: 10 lines, 300 spots, 20 marks.
      const biggest = { strokes: Array.from({ length: 10 }, () => line(30)), marks: Array.from({ length: 20 }, () => drove.marks[0]), didnt_move: false }
      expect(await insert(biggest)).toHaveLength(1)
    })

    it('refuses a path the form would never save, or one too big', async () => {
      const refused: [string, unknown][] = [
        ['not an object', [1, 2]],
        ['nothing drawn and it moved', { strokes: [], marks: [], didnt_move: false }],
        ["lines and Didn't move", { ...drove, didnt_move: true }],
        ['no didnt_move', { strokes: drove.strokes, marks: [] }],
        ['something extra', { ...drove, colour: 'red' }],
        ['a line of one spot', { ...drove, strokes: [[[0.1, 0.1]]] }],
        ['a spot off the field', { ...drove, strokes: [[[0.1, 0.1], [1.2, 0.5]]] }],
        ['a spot that is not two numbers', { ...drove, strokes: [[[0.1, 0.1], ['a', 0.5]]] }],
        ['a line that is not a list', { ...drove, strokes: [{ x: 1 }] }],
        ['11 lines', { ...drove, strokes: Array.from({ length: 11 }, () => line(2)) }],
        ['301 spots', { ...drove, strokes: [line(150), line(151)] }],
        ['21 marks', { ...drove, marks: Array.from({ length: 21 }, () => drove.marks[0]) }],
        ['a mark with no type', { ...drove, marks: [{ type: '', x: 0.1, y: 0.1 }] }],
        ['a mark type too long', { ...drove, marks: [{ type: 'x'.repeat(31), x: 0.1, y: 0.1 }] }],
        ['a mark off the field', { ...drove, marks: [{ type: 'shot', x: -0.1, y: 0.1 }] }],
      ]
      for (const [label, path] of refused) await expect(insert(path), label).rejects.toThrow('check constraint')
    })
  })

  it('refuses the short answers when empty or over 300 characters, like the form', async () => {
    const insert = (column: string, value: unknown) =>
      db.as(scout, `insert into public.scouting_entries (id, event_key, match_number, team_number, endgame, scouted_at, ${column}) values ($1, '2026test', 1, 1, 'None', now(), $2)`, [crypto.randomUUID(), value])
    for (const column of ['role_notes', 'broke_other', 'auto_notes']) {
      await expect(insert(column, ''), column).rejects.toThrow('check constraint')
      await expect(insert(column, 'x'.repeat(301)), column).rejects.toThrow('check constraint')
      expect(await insert(column, 'x'.repeat(300)), column).toEqual([])
    }
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
