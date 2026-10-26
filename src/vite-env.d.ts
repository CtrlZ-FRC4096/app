/// <reference types="vite/client" />

// Settings the site is built with. See src/core/supabase.ts.
interface ImportMetaEnv {
  /** The team database's address, like https://abcdefgh.supabase.co. Leave it out to run on example data. */
  readonly VITE_SUPABASE_URL?: string
  /** The team database's publishable key (sb_publishable_...). Never the secret key. */
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string
}
