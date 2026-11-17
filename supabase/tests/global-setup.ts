/**
 * Runs once before all the tests (vite.config.ts, test.globalSetup). It
 * builds the test database with every migration run, and gives each test
 * file a saved copy to load (setUpTestDatabase() in database.ts), so the
 * migrations run once per test run rather than once per test file. That
 * saves about 2 seconds for every file in supabase/tests.
 */
import type { TestProject } from 'vitest/node'
import { buildTestDatabase } from './database'

export default async function setup(project: TestProject) {
  const db = await buildTestDatabase()
  const saved = await db.dumpDataDir('none')
  project.provide('testDatabase', await saved.arrayBuffer())
  await db.close()
}
