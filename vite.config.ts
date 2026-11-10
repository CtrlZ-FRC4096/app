import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import { defineConfig } from 'vitest/config'
import { appFileList, fillWorker } from './src/core/appFiles.ts'

/**
 * After a build, write the list of the app's files, and a version made from
 * their contents, into dist/sw.js. The service worker keeps them on the
 * device so the app opens with no connection (src/core/offline.ts). A new
 * version of any file makes a new version of the worker, which is how
 * phones find out there's an update.
 */
function offlineFiles(): Plugin {
  let outDir = 'dist'
  let skip = false
  return {
    name: 'offline-files',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir)
      // Scripts are built on their own (scripts/*.ts): they have no worker.
      skip = Boolean(config.build.ssr)
    },
    closeBundle() {
      const worker = join(outDir, 'sw.js')
      if (skip || !existsSync(worker)) return
      const all = readdirSync(outDir, { recursive: true, encoding: 'utf8' }).filter((path) => statSync(join(outDir, path)).isFile())
      const files = appFileList(all)
      const hash = createHash('sha256')
      for (const file of files) hash.update(file).update(readFileSync(join(outDir, file)))
      writeFileSync(worker, fillWorker(readFileSync(worker, 'utf8'), files, hash.digest('hex').slice(0, 12)))
    },
  }
}

// The site is served from https://ctrlz-frc4096.github.io/app/ until the
// app.team4096.org DNS record exists, and from the root of that domain after.
// A relative base works in both places, and the app uses #/ addresses, so no
// page ever needs a server to find it.
export default defineConfig({
  base: './',
  plugins: [react(), offlineFiles()],
  test: {
    environment: 'node',
    // Tests always run in demo mode, even if .env.local connects your
    // computer to the team database.
    env: {
      VITE_SUPABASE_URL: '',
      VITE_SUPABASE_PUBLISHABLE_KEY: '',
    },
    // Each file in supabase/tests starts its own test database before its
    // tests run. With every file starting at once on a busy computer, that
    // can take longer than the usual 10 seconds, even though each test
    // itself is quick (they keep the usual limit).
    hookTimeout: 30_000,
  },
})
