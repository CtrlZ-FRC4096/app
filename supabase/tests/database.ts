/**
 * A test database for checking permission rules.
 *
 * setUpTestDatabase() gives a test file its own in-memory Postgres (PGlite)
 * with a stand-in for Supabase (supabase-stub.sql) and every migration in
 * supabase/migrations/ already run, and empties it before each test. Nothing
 * touches the real team database.
 *
 *   const db = setUpTestDatabase()
 *   const student = await db.member('Test Student')
 *   const mentor = await db.member('Test Mentor', 'mentor')
 *   await db.as(student, "insert into public.example_notes (text) values ('Hi')")
 *   await db.as(mentor, 'delete from public.example_notes returning id')
 *
 * db.as(person, sql) runs SQL the way the app would for that person, with
 * their permissions. db.as(null, sql) is someone who isn't signed in.
 * db.sql(sql) runs it as the database owner, like Supabase's SQL editor, with
 * no rules applied: use it to set things up and to check what really changed.
 */
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, beforeEach, inject } from 'vitest'
import stub from './supabase-stub.sql?raw'

const migrationFiles = import.meta.glob('../migrations/*.sql', { query: '?raw', import: 'default', eager: true })

/** Every migration, in the order Supabase runs them (by file name). */
export const migrations: { file: string; sql: string }[] = Object.entries(migrationFiles)
  .map(([path, sql]) => ({ file: path.split('/').pop()!, sql: sql as string }))
  .sort((a, b) => a.file.localeCompare(b.file))

/** The Slack workspace the test database lets in. */
export const TEAM_SLACK_ID = 'T0CTRLZ4096'

export type Role = 'student' | 'leader' | 'mentor' | 'admin'
type Params = unknown[]

declare module 'vitest' {
  export interface ProvidedContext {
    /** The test database with every migration run, saved by global-setup.ts. */
    testDatabase?: ArrayBuffer
  }
}

/**
 * A new database with the stand-in for Supabase and every migration run.
 * global-setup.ts makes this once for the whole test run, which takes a
 * couple of seconds, and each test file loads a copy of it.
 */
export async function buildTestDatabase(): Promise<PGlite> {
  const db = await PGlite.create()
  await db.exec(stub)
  for (const { file, sql } of migrations) {
    try {
      await db.exec(sql)
    } catch (error) {
      throw new Error(`Migration ${file} failed: ${(error as Error).message}`, { cause: error })
    }
  }
  return db
}

/** A database for the tests in this file, emptied before each test. */
export function setUpTestDatabase(): TestDatabase {
  const db = new TestDatabase()
  beforeAll(async () => {
    const saved = inject('testDatabase')
    // Loading the saved copy takes a fraction of a second. Without one (if
    // the global setup didn't run), build it here instead.
    db.db = saved ? await PGlite.create({ loadDataDir: new Blob([saved]) }) : await buildTestDatabase()
  })
  beforeEach(() => db.empty())
  return db
}

let slackUsers = 0

export class TestDatabase {
  db!: PGlite
  /** The SQL that empties the tables, worked out the first time it's needed. */
  private emptySql: string | undefined

  /** Remove every account and every row in every app table, and let the test Slack workspace in. */
  async empty() {
    this.emptySql ??= await this.makeEmptySql()
    await this.db.exec(this.emptySql)
    await this.sql('insert into private.settings (key, value) values ($1, $2)', ['slack_team_id', TEAM_SLACK_ID])
  }

  /**
   * SQL that empties the accounts, the settings, every app table and every
   * table that points at one of them (the same tables "truncate ... cascade"
   * reaches). It deletes the rows instead: with only a few rows, that's about
   * 7 times faster than truncate, which matters because it runs before every
   * test. session_replication_role = replica switches off triggers and
   * foreign key checks while it does, so the order doesn't matter.
   */
  private async makeEmptySql(): Promise<string> {
    const app = await this.sql<{ name: string }>("select format('%I.%I', schemaname, tablename) as name from pg_tables where schemaname = 'public'")
    const tables = new Set(['auth.users', 'private.settings', ...app.map((t) => t.name)])
    for (;;) {
      const pointing = await this.sql<{ name: string }>(
        `select distinct format('%I.%I', n.nspname, c.relname) as name
         from pg_constraint k
           join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace
           join pg_class r on r.oid = k.confrelid join pg_namespace rn on rn.oid = r.relnamespace
         where k.contype = 'f' and format('%I.%I', rn.nspname, r.relname) = any($1)`,
        [[...tables]],
      )
      const before = tables.size
      for (const { name } of pointing) tables.add(name)
      if (tables.size === before) break
    }
    return ['set session_replication_role = replica;', ...[...tables].map((t) => `delete from ${t};`), 'set session_replication_role = default;'].join('\n')
  }

  /** Run SQL as the database owner. Permission rules don't apply. */
  async sql<T = Record<string, unknown>>(query: string, params: Params = []): Promise<T[]> {
    return (await this.db.query<T>(query, params)).rows
  }

  /**
   * Run SQL as someone using the app: a signed-in person's id, or null for
   * someone who isn't signed in. Their permission rules apply.
   */
  async as<T = Record<string, unknown>>(person: string | null, query: string, params: Params = []): Promise<T[]> {
    const role = person ? 'authenticated' : 'anon'
    const claims = JSON.stringify(person ? { sub: person, role } : { role })
    return this.db.transaction(async (tx) => {
      await tx.query(`select set_config('role', $1, true), set_config('request.jwt.claims', $2, true)`, [role, claims])
      return (await tx.query<T>(query, params)).rows
    })
  }

  /**
   * Sign in with Slack the way Supabase does: it adds an account to
   * auth.users with what Slack said about the person. Returns the new
   * account's id. Throws if the database turns the person away.
   */
  async slackSignIn(person: { name: string; team?: string; provider?: string; id?: string; picture?: string }): Promise<string> {
    slackUsers += 1
    const slackUserId = `U0TEST${slackUsers}`
    const team = person.team ?? TEAM_SLACK_ID
    const provider = person.provider ?? 'slack_oidc'
    const userMeta = {
      iss: 'https://slack.com/api',
      sub: slackUserId,
      name: person.name,
      picture: person.picture ?? `https://example.com/${slackUserId}.png`,
      custom_claims: { 'https://slack.com/team_id': team },
      full_name: person.name,
      avatar_url: person.picture ?? `https://example.com/${slackUserId}.png`,
      provider_id: slackUserId,
      email_verified: true,
      phone_verified: false,
    }
    const appMeta = { provider, providers: [provider] }
    // Like Supabase: make the account, then record the Slack identity.
    return this.db.transaction(async (tx) => {
      await tx.query(`select set_config('role', 'supabase_auth_admin', true)`)
      const [{ id }] = (
        await tx.query<{ id: string }>(
          `insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
           values (coalesce($1::uuid, gen_random_uuid()), $2, $3, $4) returning id`,
          [person.id ?? null, `${slackUserId.toLowerCase()}@example.com`, appMeta, userMeta],
        )
      ).rows
      await tx.query('insert into auth.identities (provider_id, user_id, identity_data, provider) values ($1, $2, $3, $4)', [
        slackUserId,
        id,
        userMeta,
        provider,
      ])
      return id
    })
  }

  /**
   * Sign someone in again, the way Supabase does: it saves what Slack says
   * now in auth.identities, then copies it into the account.
   */
  async slackSignInAgain(id: string, changes: { name?: string; picture?: string }) {
    await this.db.transaction(async (tx) => {
      await tx.query(`select set_config('role', 'supabase_auth_admin', true)`)
      await tx.query("update auth.identities set identity_data = identity_data || $2, updated_at = now() where user_id = $1 and provider = 'slack_oidc'", [id, changes])
      await tx.query('update auth.users set raw_user_meta_data = raw_user_meta_data || $2 where id = $1', [id, changes])
    })
  }

  /** A team member who has signed in, with the role given. Returns their id. */
  async member(name: string, role: Role = 'student'): Promise<string> {
    const id = await this.slackSignIn({ name })
    if (role !== 'student') await this.sql('update public.members set role = $1 where id = $2', [role, id])
    return id
  }

  /** Put someone on the scouting strategy team (#167), the way a mentor would. */
  async strategy(id: string) {
    await this.sql('insert into public.scouting_strategy_team (member_id) values ($1)', [id])
  }

  /** Switch off someone's access, the way an admin would. */
  async switchOff(id: string) {
    await this.sql('update public.members set active = false where id = $1', [id])
  }
}

/** The message a database error carries, for expect(...).rejects.toThrow(). */
export const PERMISSION_DENIED = /row-level security|permission denied/
