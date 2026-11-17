// Permission rules for the Pit checklist (#146). One test for each thing the
// rules should allow or stop. Student leaders run the checklist like
// mentors and admins (..._pit_checklist_student_leaders.sql).
import { beforeEach, describe, expect, it } from 'vitest'
import { PERMISSION_DENIED, setUpTestDatabase } from './database'

const db = setUpTestDatabase()
let student: string
let other: string
let leader: string
let mentor: string
let admin: string

beforeEach(async () => {
  student = await db.member('Riley Park')
  other = await db.member('Casey Lee')
  leader = await db.member('Casey Leader', 'leader')
  mentor = await db.member('Pat Mentor', 'mentor')
  admin = await db.member('Morgan Admin', 'admin')
})

/** A mentor adds an item assigned to `assignees`. */
const addItem = async (assignees: string[], text = 'Batteries charged') => {
  const [item] = await db.as<{ id: string; created_by: string }>(
    mentor,
    'insert into public.pit_checklist_items (text, assignee_ids) values ($1, $2) returning *',
    [text, assignees],
  )
  return item
}

const check = (person: string, itemId: string, match = '2026test_qm12') =>
  db.as<{ id: string; created_by: string }>(person, 'insert into public.pit_checklist_checks (item_id, match_key) values ($1, $2) returning *', [itemId, match])

describe('pit checklist items', () => {
  it('lets every member read the items', async () => {
    await addItem([student])
    expect(await db.as(other, 'select text from public.pit_checklist_items')).toEqual([{ text: 'Batteries charged' }])
  })

  it('lets a student leader, mentor or admin add an item, signed as themselves', async () => {
    expect((await addItem([student])).created_by).toBe(mentor)
    await db.as(admin, "insert into public.pit_checklist_items (text) values ('Bumpers packed')")
    const [mine] = await db.as<{ created_by: string }>(leader, "insert into public.pit_checklist_items (text) values ('Tools packed') returning created_by")
    expect(mine.created_by).toBe(leader)
  })

  it("doesn't let a student leader add an item as someone else", async () => {
    await expect(
      db.as(leader, "insert into public.pit_checklist_items (text, created_by) values ('Tools packed', $1)", [mentor]),
    ).rejects.toThrow(PERMISSION_DENIED)
  })

  it("doesn't let a student add an item", async () => {
    await expect(db.as(student, "insert into public.pit_checklist_items (text, assignee_ids) values ('Mine', $1)", [[student]])).rejects.toThrow(PERMISSION_DENIED)
  })

  it("doesn't let a student rename, assign or reorder an item, even one assigned to them", async () => {
    const item = await addItem([student])
    for (const change of ["text = 'Renamed'", `assignee_ids = '{${other}}'`, 'position = 9']) {
      expect(await db.as(student, `update public.pit_checklist_items set ${change} where id = $1 returning id`, [item.id])).toEqual([])
    }
    expect(await db.sql('select text, position from public.pit_checklist_items')).toEqual([{ text: 'Batteries charged', position: 0 }])
  })

  it('lets a student leader or mentor rename, assign and reorder an item', async () => {
    const item = await addItem([student])
    for (const person of [leader, mentor]) {
      expect(
        await db.as(person, "update public.pit_checklist_items set text = 'Renamed', assignee_ids = $2, position = 3 where id = $1 returning text, position", [item.id, [other]]),
      ).toEqual([{ text: 'Renamed', position: 3 }])
    }
  })

  it('can be deleted by a mentor, not by a student, and its checks go with it', async () => {
    const item = await addItem([student])
    await check(student, item.id)
    expect(await db.as(student, 'delete from public.pit_checklist_items where id = $1 returning id', [item.id])).toEqual([])
    expect(await db.as(mentor, 'delete from public.pit_checklist_items where id = $1 returning id', [item.id])).toEqual([{ id: item.id }])
    expect(await db.sql('select * from public.pit_checklist_checks')).toEqual([])
  })

  it('can be deleted by a student leader, which is how they clear the list', async () => {
    const first = await addItem([student], 'First')
    await addItem([other], 'Second')
    await check(student, first.id)
    expect(await db.as(leader, 'delete from public.pit_checklist_items returning id')).toHaveLength(2)
    expect(await db.sql('select * from public.pit_checklist_checks')).toEqual([])
  })
})

describe('pit checklist checks', () => {
  it('lets a student check an item assigned to them, signed as themselves', async () => {
    const item = await addItem([student, other])
    expect((await check(student, item.id)).at(0)?.created_by).toBe(student)
  })

  it("refuses a student checking someone else's item", async () => {
    const item = await addItem([other])
    await expect(check(student, item.id)).rejects.toThrow(PERMISSION_DENIED)
  })

  it("doesn't let anyone check as someone else", async () => {
    const item = await addItem([student])
    await expect(
      db.as(other, "insert into public.pit_checklist_checks (item_id, match_key, created_by) values ($1, '2026test_qm12', $2)", [item.id, student]),
    ).rejects.toThrow(PERMISSION_DENIED)
  })

  it('lets a student leader, mentor or admin check any item', async () => {
    const item = await addItem([student])
    await check(mentor, item.id, '2026test_qm12')
    await check(admin, item.id, '2026test_qm13')
    expect((await check(leader, item.id, '2026test_qm14')).at(0)?.created_by).toBe(leader)
  })

  it('checks an item once for each match, so each match starts fresh', async () => {
    const item = await addItem([student])
    await check(student, item.id, '2026test_qm12')
    await expect(check(student, item.id, '2026test_qm12')).rejects.toThrow('unique constraint')
    await check(student, item.id, 'practice')
    expect(await db.as(mentor, 'select match_key from public.pit_checklist_checks order by match_key')).toEqual([
      { match_key: '2026test_qm12' },
      { match_key: 'practice' },
    ])
  })

  it('lets every member see every check, so a mentor sees a student’s on their own phone', async () => {
    const item = await addItem([student])
    await check(student, item.id)
    expect(await db.as(mentor, 'select created_by from public.pit_checklist_checks')).toEqual([{ created_by: student }])
    expect(await db.as(other, 'select created_by from public.pit_checklist_checks')).toEqual([{ created_by: student }])
  })

  it("lets a student uncheck their own item, but not someone else's", async () => {
    const mine = await addItem([student], 'Mine')
    const theirs = await addItem([other], 'Theirs')
    const [myCheck] = await check(student, mine.id)
    const [theirCheck] = await check(other, theirs.id)
    expect(await db.as(student, 'delete from public.pit_checklist_checks where id = $1 returning id', [theirCheck.id])).toEqual([])
    expect(await db.as(student, 'delete from public.pit_checklist_checks where id = $1 returning id', [myCheck.id])).toEqual([{ id: myCheck.id }])
  })

  it('lets a mentor uncheck any item', async () => {
    const item = await addItem([student])
    const [row] = await check(student, item.id)
    expect(await db.as(mentor, 'delete from public.pit_checklist_checks where id = $1 returning id', [row.id])).toEqual([{ id: row.id }])
  })

  it("lets a student leader uncheck everything for a match, and a student only their own", async () => {
    const mine = await addItem([student], 'Mine')
    const theirs = await addItem([other], 'Theirs')
    await check(student, mine.id, 'practice')
    await check(other, theirs.id, 'practice')
    await check(other, theirs.id, '2026test_qm12')
    expect(await db.as(student, "delete from public.pit_checklist_checks where match_key = 'practice' returning id")).toHaveLength(1)
    expect(await db.as(leader, "delete from public.pit_checklist_checks where match_key = 'practice' returning id")).toHaveLength(1)
    expect(await db.sql('select match_key from public.pit_checklist_checks')).toEqual([{ match_key: '2026test_qm12' }])
  })

  it("can't be changed, only added or removed", async () => {
    const item = await addItem([student])
    const [row] = await check(student, item.id)
    await expect(db.as(mentor, "update public.pit_checklist_checks set match_key = 'practice' where id = $1", [row.id])).rejects.toThrow(PERMISSION_DENIED)
  })
})

describe('signed out or switched off', () => {
  it("can't read or change anything when not signed in", async () => {
    const item = await addItem([student])
    await expect(db.as(null, 'select * from public.pit_checklist_items')).rejects.toThrow(PERMISSION_DENIED)
    await expect(db.as(null, 'select * from public.pit_checklist_checks')).rejects.toThrow(PERMISSION_DENIED)
    await expect(check(null as unknown as string, item.id)).rejects.toThrow(PERMISSION_DENIED)
  })

  it("can't change anything as a student leader whose access is off", async () => {
    const item = await addItem([student])
    await db.switchOff(leader)
    await expect(db.as(leader, "insert into public.pit_checklist_items (text) values ('Tools packed')")).rejects.toThrow(PERMISSION_DENIED)
    expect(await db.as(leader, 'delete from public.pit_checklist_items where id = $1 returning id', [item.id])).toEqual([])
    await expect(check(leader, item.id)).rejects.toThrow(PERMISSION_DENIED)
  })

  it("can't read or check when their access is off", async () => {
    const item = await addItem([student])
    await db.switchOff(student)
    expect(await db.as(student, 'select * from public.pit_checklist_items')).toEqual([])
    await expect(check(student, item.id)).rejects.toThrow(PERMISSION_DENIED)
  })
})
