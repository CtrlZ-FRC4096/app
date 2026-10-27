import { afterEach, describe, expect, it, vi } from 'vitest'
import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js'

afterEach(() => {
  vi.doUnmock('./supabase')
  vi.resetModules()
})

// Load functions.ts with a pretend Supabase client whose invoke() answers `answer`.
async function live(answer: { data: unknown; error: unknown }) {
  const invoke = vi.fn(async () => answer)
  vi.resetModules()
  vi.doMock('./supabase', () => ({ supabase: { functions: { invoke } } }))
  const { callFunction } = await import('./functions')
  return { callFunction, invoke }
}

const httpError = (status: number, body: unknown) =>
  new FunctionsHttpError(new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }))

describe('callFunction', () => {
  it('answers with the example data in demo mode', async () => {
    const { callFunction } = await import('./functions')
    expect(await callFunction('tba', { kind: 'team', team: 4096 }, () => ({ nickname: 'Ctrl-Z' }))).toEqual({ ok: true, value: { nickname: 'Ctrl-Z' } })
  })

  it('calls the server function and passes on its answer', async () => {
    const { callFunction, invoke } = await live({ data: { message: 'Hi Pat' }, error: null })
    expect(await callFunction('hello', {}, () => null)).toEqual({ ok: true, value: { message: 'Hi Pat' } })
    expect(invoke).toHaveBeenCalledWith('hello', { body: {} })
  })

  it("shows the function's own error message", async () => {
    const { callFunction } = await live({ data: null, error: httpError(503, { error: "The Blue Alliance key isn't set up yet." }) })
    expect(await callFunction('tba', {}, () => null)).toEqual({ ok: false, error: "The Blue Alliance key isn't set up yet." })
  })

  it('explains a missing function, an expired sign-in, and no connection', async () => {
    expect(await (await live({ data: null, error: httpError(404, 'Not found') })).callFunction('tba', {}, () => null)).toEqual({
      ok: false, error: "The tba server function isn't set up yet. A mentor can check the Deploy workflow.",
    })
    expect(await (await live({ data: null, error: httpError(401, { msg: 'Invalid JWT' }) })).callFunction('tba', {}, () => null)).toMatchObject({
      ok: false, error: expect.stringMatching(/sign in again/),
    })
    expect(await (await live({ data: null, error: new FunctionsFetchError(new TypeError('fetch failed')) })).callFunction('tba', {}, () => null)).toMatchObject({
      ok: false, error: expect.stringMatching(/Couldn't reach/),
    })
  })
})
