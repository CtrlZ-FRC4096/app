/**
 * Server functions: code that runs on Supabase's servers instead of in the
 * browser, for anything that needs a secret key, like The Blue Alliance.
 * They live in supabase/functions/; see "Server functions" in
 * supabase/README.md.
 *
 * A module's data.ts calls one with callFunction(), never the page. In demo
 * mode (your computer, the tests, and the site until the database is set
 * up) there are no server functions, so callFunction() returns the example
 * data you give it instead, and the module still works without any keys.
 */
import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { fail, ok, type Result } from './table'

/**
 * Call the server function `name` with `body`, and get its answer.
 *
 * @param demo  What to answer in demo mode: made-up data in the same shape.
 */
export async function callFunction<T>(name: string, body: unknown, demo: () => T): Promise<Result<T>> {
  if (!supabase) return ok(demo())
  const { data, error } = await supabase.functions.invoke<T>(name, { body: body as Record<string, unknown> })
  if (!error) return ok(data as T)
  return fail(await explainFunctionError(name, error))
}

/** Turn a failed call into something to show the person. Functions answer `{ error: '...' }` written for people. */
async function explainFunctionError(name: string, error: unknown): Promise<string> {
  if (error instanceof FunctionsHttpError) {
    const answer = error.context as Response
    try {
      const body = (await answer.clone().json()) as { error?: unknown; message?: unknown }
      if (typeof body.error === 'string') return body.error
    } catch {
      // Not JSON: fall through to a message from the status.
    }
    if (answer.status === 401) return 'Your sign-in has run out. Reload the page and sign in again.'
    if (answer.status === 404) return `The ${name} server function isn't set up yet. A mentor can check the Deploy workflow.`
    return `The ${name} server function had a problem (${answer.status}). Try again in a minute.`
  }
  return "Couldn't reach the server. Check your connection and try again."
}
