// Checks every table, so a new module's table can't be forgotten or left
// open. You don't need to edit this when you add a table: it finds them by
// itself, from the migrations and from every createTable() in the app.
import { describe, expect, it } from 'vitest'
import { allTables, type Row, type Table } from '../../src/core/table'
import { DEMO_PEOPLE } from '../../src/core/demo'
import { setUpTestDatabase } from './database'

// Load every module's data.ts so all their tables are made.
import.meta.glob('../../src/modules/*/data.ts', { eager: true })
import '../../src/core/members'

const db = setUpTestDatabase()
const tables = allTables()

describe('every table in the database', () => {
  it('has row level security on, so only its rules let anyone in', async () => {
    const open = await db.sql<{ name: string }>(
      "select relname as name from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and not relrowsecurity",
    )
    expect(open.map((t) => t.name), 'Add "alter table ... enable row level security" to the migration').toEqual([])
  })

  it("gives people who aren't signed in nothing", async () => {
    const reachable = await db.sql<{ name: string }>(
      `select relname as name from pg_class
       where relnamespace = 'public'::regnamespace and relkind = 'r'
         and has_table_privilege('anon', oid, 'select, insert, update, delete')`,
    )
    expect(reachable.map((t) => t.name), 'Add "revoke all on table ... from anon, authenticated" to the migration').toEqual([])
  })
})

describe.each(tables.map((t) => [t.name, t] as const))('the %s table', (name, table) => {
  it('is made by a migration', async () => {
    const found = await db.sql('select 1 from pg_tables where schemaname = $1 and tablename = $2', ['public', name])
    expect(found, `No migration makes public.${name}. Copy supabase/migrations/..._example_notes.sql.`).toHaveLength(1)
  })

  it('sends live updates to the app', async () => {
    const found = await db.sql("select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = $1", [name])
    expect(found, `Add "alter publication supabase_realtime add table public.${name}" to the migration`).toHaveLength(1)
  })

  it('has example rows with exactly its columns', async () => {
    const columns = (await db.sql<{ name: string }>(
      'select column_name as name from information_schema.columns where table_schema = $1 and table_name = $2 order by 1',
      ['public', name],
    )).map((c) => c.name)
    for (const row of table.demoRows) {
      expect(Object.keys(row).sort(), `An example row in ${name} doesn't match the table's columns`).toEqual(columns)
    }
  })

  it('accepts its example rows', async () => {
    await addDemoPeople()
    await insertDemoRows(table)
  })
})

// The made-up people, signed in like real ones, so example rows can say
// who made them.
async function addDemoPeople() {
  for (const id of Object.values(DEMO_PEOPLE)) {
    await db.slackSignIn({ name: 'Demo person', id })
  }
}

async function insertDemoRows(table: Table<Row>) {
  // Tables that point at other tables need those rows first.
  const needs = await db.sql<{ needed: string }>(
    `select distinct confrelid::regclass::text as needed from pg_constraint
     where contype = 'f' and conrelid = $1::regclass and confrelid <> conrelid`,
    [`public.${table.name}`],
  )
  for (const { needed } of needs) {
    const other = tables.find((t) => `public.${t.name}` === needed || t.name === needed)
    if (other && other !== table) await insertDemoRows(other)
  }
  const rows = table.demoRows.map((row) => row as object)
  if (table.name === 'members') {
    // Sign-in already added these people: update them to match the example rows.
    await db.sql(
      `update public.members m set slack_user_id = r.slack_user_id, name = r.name, avatar_url = r.avatar_url,
         role = r.role, active = r.active, created_at = r.created_at
       from jsonb_populate_recordset(null::public.members, $1) r where m.id = r.id`,
      [rows],
    )
    return
  }
  await db.sql(
    `insert into public.${table.name} select * from jsonb_populate_recordset(null::public.${table.name}, $1) on conflict do nothing`,
    [rows],
  )
}
