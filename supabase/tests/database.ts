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
import { beforeAll, beforeEach } from 'vitest'
import stub from './supabase-stub.sql?raw'

const migrationFiles = import.meta.glob('../migrations/*.sql', { query: '?raw', import: 'default', eager: true })

/** Every migration, in the order Supabase runs them (by file name). */
export const migrations: { file: string; sql: string }[] = Object.entries(migrationFiles)
  .map(([path, sql]) => ({ file: path.split('/').pop()!, sql: sql as string }))
  .sort((a, b) => a.file.localeCompare(b.file))

/** The Slack workspace the test database lets in. */
export const TEAM_SLACK_ID = 'T0CTRLZ4096'

export type Role = 'student' | 'mentor' | 'admin'
type Params = unknown[]

let template: Promise<PGlite> | undefined

async function buildTemplate(): Promise<PGlite> {
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
    template ??= buildTemplate()
    db.db = (await (await template).clone()) as PGlite
  })
  beforeEach(() => db.empty())
  return db
}

let slackUsers = 0

export class TestDatabase {
  db!: PGlite

  /** Remove every account and every row in every app table, and let the test Slack workspace in. */
  async empty() {
    const tables = await this.sql<{ name: string }>("select format('%I.%I', schemaname, tablename) as name from pg_tables where schemaname = 'public'")
    await this.db.exec(`truncate ${['auth.users', 'private.settings', ...tables.map((t) => t.name)].join(', ')} cascade`)
    await this.sql('insert into private.settings (key, value) values ($1, $2)', ['slack_team_id', TEAM_SLACK_ID])
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

  /** Switch off someone's access, the way an admin would. */
  async switchOff(id: string) {
    await this.sql('update public.members set active = false where id = $1', [id])
  }
}

/** The message a database error carries, for expect(...).rejects.toThrow(). */
export const PERMISSION_DENIED = /row-level security|permission denied/
