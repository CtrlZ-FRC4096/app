/**
 * The connection to the team database (Supabase), or null in demo mode.
 *
 * The site runs in live mode when it is built with the database's address
 * and publishable key, VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.
 * The deploy workflow passes them in from the repo's settings. Without them
 * the site runs in demo mode on example data: that's how it runs on your
 * computer, in the tests, and on the live site until the database is set up.
 *
 * The publishable key is meant to be public. It only lets the browser ask;
 * the permission rules in supabase/migrations/ decide what each person gets.
 * The secret key must never be used in the site or anywhere in this repo.
 */
import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

if (key && looksSecret(key)) {
  throw new Error('VITE_SUPABASE_PUBLISHABLE_KEY is a secret key. Use the publishable key: the secret key must never be in the site.')
}

/**
 * Why the last sign-in didn't work, if Slack or Supabase sent someone back
 * with an error. It's read from the address (and removed from it) before
 * the client below starts, so the client doesn't trip over it.
 */
export const signInError: string | null = url && key ? takeSignInError() : null

export const supabase =
  url && key
    ? createClient(url, key, {
        auth: {
          // Sign-in comes back as ?code=... instead of in the part after #,
          // which the app uses for its own addresses (#/inventory).
          flowType: 'pkce',
          detectSessionInUrl: true,
          persistSession: true,
          autoRefreshToken: true,
        },
      })
    : null

/** True when the site is connected to the team database. */
export const isLive = supabase !== null

function looksSecret(value: string): boolean {
  if (value.startsWith('sb_secret_')) return true
  // Older projects use JWT keys. The secret one says service_role inside.
  const payload = value.split('.')[1]
  if (!payload) return false
  try {
    return atob(payload.replace(/-/g, '+').replace(/_/g, '/')).includes('service_role')
  } catch {
    return false
  }
}

function takeSignInError(): string | null {
  if (typeof window === 'undefined') return null
  const address = new URL(window.location.href)
  // Errors come back after ? (or after # in older flows, never #/...).
  const fromHash = address.hash.startsWith('#/') ? new URLSearchParams() : new URLSearchParams(address.hash.slice(1))
  const code = address.searchParams.get('error') ?? fromHash.get('error')
  const description = address.searchParams.get('error_description') ?? fromHash.get('error_description')
  if (!code && !description) return null

  for (const name of ['error', 'error_code', 'error_description']) address.searchParams.delete(name)
  if (fromHash.has('error') || fromHash.has('error_description')) address.hash = ''
  window.history.replaceState(window.history.state, '', address.toString())
  return explainSignInError(code, description)
}

export function explainSignInError(code: string | null, description: string | null): string {
  if (code === 'access_denied') return 'Sign-in was cancelled. Try again when you are ready.'
  // The database turned the person away (see the members migration).
  if (description?.includes('Database error saving new user')) {
    return 'Only members of the Ctrl-Z Slack workspace can sign in. If Slack asks which workspace, pick Ctrl-Z. If that is what you did, ask a mentor.'
  }
  return `Sign-in didn't work (${description ?? code}). Try again, or ask a mentor.`
}
