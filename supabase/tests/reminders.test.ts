// The SQL the scheduled Slack reminders read tables with (tablesQuery() in
// src/core/reminders.ts), run against the real migrations: it returns every
// row of each table, and can't change anything.
import { describe, expect, it } from 'vitest'
import { tablesQuery } from '../../src/core/reminders'
import { setUpTestDatabase } from './database'

const db = setUpTestDatabase()

describe('tablesQuery', () => {
  it('reads every row of each table as JSON', async () => {
    const alex = await db.member('Alex Rivera')
    await db.sql("insert into public.example_notes (text, created_by) values ('Hi', $1)", [alex])
    const results = await db.db.exec(tablesQuery(['members', 'example_notes']))
    const tables = results[1].rows[0].json_build_object as Record<string, Record<string, unknown>[]>
    expect(tables.members).toEqual([expect.objectContaining({ id: alex, name: 'Alex Rivera', active: true, slack_user_id: expect.stringMatching(/^U/) })])
    expect(tables.example_notes).toEqual([expect.objectContaining({ text: 'Hi', created_by: alex })])
  })

  it('gives an empty list for an empty table', async () => {
    const results = await db.db.exec(tablesQuery(['members']))
    expect(results[1].rows[0].json_build_object).toEqual({ members: [] })
  })

  it("runs read-only, so nothing in it can change the database", async () => {
    const write = tablesQuery(['members']).replace(/select json_build_object.*\n/, "insert into public.example_notes (text) values ('x');\n")
    await expect(db.db.exec(write)).rejects.toThrow(/read-only transaction/)
    await db.db.exec('rollback')
  })
})
