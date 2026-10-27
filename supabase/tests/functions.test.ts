// Tests for the parts of the server functions (supabase/functions/) that
// don't need Deno or a network: reading the caller's ID from their token,
// and what the tba function asks The Blue Alliance.
import { describe, expect, it, vi } from 'vitest'
import { tokenSubject } from '../functions/_shared/token.ts'
import { createTba, tbaPath, TBA_API } from '../functions/tba/tba.ts'

const ID = '00000000-0000-4000-8000-000000000001'
const base64url = (value: object) => btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const token = (claims: object) => `Bearer ${base64url({ alg: 'ES256' })}.${base64url(claims)}.signature`

describe('tokenSubject', () => {
  it("reads the user's ID from a sign-in token", () => {
    expect(tokenSubject(token({ sub: ID, role: 'authenticated' }))).toBe(ID)
  })

  it("is null with no token, a publishable key, or a token that isn't one", () => {
    expect(tokenSubject(null)).toBeNull()
    expect(tokenSubject('Bearer sb_publishable_abc')).toBeNull()
    expect(tokenSubject('Bearer a.!!!.c')).toBeNull()
    expect(tokenSubject(token({ role: 'anon' }))).toBeNull()
    expect(tokenSubject(token({ sub: "1' or '1'='1" }))).toBeNull()
  })
})

describe('tbaPath', () => {
  it('allows the four things scouting needs', () => {
    expect(tbaPath({ kind: 'schedule', event: '2026ilch' })).toEqual({ path: '/event/2026ilch/matches/simple' })
    expect(tbaPath({ kind: 'rankings', event: '2026ilch' })).toEqual({ path: '/event/2026ilch/rankings' })
    expect(tbaPath({ kind: 'team-matches', team: 4096, event: '2026ilch' })).toEqual({ path: '/team/frc4096/event/2026ilch/matches' })
    expect(tbaPath({ kind: 'team', team: 4096 })).toEqual({ path: '/team/frc4096/simple' })
  })

  it("refuses anything else, so the key can't be used for other requests", () => {
    expect(tbaPath({ kind: 'status' })).toHaveProperty('error')
    expect(tbaPath(null)).toHaveProperty('error')
    expect(tbaPath({ kind: 'rankings', event: '../../account' })).toHaveProperty('error')
    expect(tbaPath({ kind: 'rankings', event: '2026ILCH' })).toHaveProperty('error')
    expect(tbaPath({ kind: 'team', team: '4096/../' })).toHaveProperty('error')
    expect(tbaPath({ kind: 'team', team: 4096.5 })).toHaveProperty('error')
    expect(tbaPath({ kind: 'team-matches', team: 4096 })).toHaveProperty('error')
  })
})

describe('createTba', () => {
  const rankings = '{"rankings":[]}'
  const answer = (status: number, body = '', headers: Record<string, string> = {}) => new Response(status === 304 ? null : body, { status, headers })

  it('sends the key, and passes the answer on', async () => {
    const fetch = vi.fn(async () => answer(200, rankings))
    const ask = createTba('key123', { fetch })
    expect(await ask('/event/2026ilch/rankings')).toMatchObject({ status: 200, body: rankings })
    expect(fetch).toHaveBeenCalledWith(`${TBA_API}/event/2026ilch/rankings`, { headers: { 'X-TBA-Auth-Key': 'key123', Accept: 'application/json' } })
  })

  it('reuses an answer for a minute, then checks it with If-Modified-Since', async () => {
    let time = 0
    const fetch = vi.fn(async () => answer(200, rankings, { 'Last-Modified': 'Tue, 27 Oct 2026 15:00:00 GMT' }))
    const ask = createTba('k', { fetch, now: () => time })
    await ask('/event/2026ilch/rankings')
    time = 59_000
    await ask('/event/2026ilch/rankings')
    expect(fetch).toHaveBeenCalledTimes(1)

    time = 61_000
    fetch.mockImplementationOnce(async () => answer(304))
    expect(await ask('/event/2026ilch/rankings')).toMatchObject({ status: 200, body: rankings })
    expect(fetch).toHaveBeenLastCalledWith(expect.any(String), {
      headers: expect.objectContaining({ 'If-Modified-Since': 'Tue, 27 Oct 2026 15:00:00 GMT' }),
    })
  })

  it('says what went wrong: a bad key, an unknown event, or TBA being down', async () => {
    const error = async (response: () => Promise<Response>) => {
      const result = await createTba('k', { fetch: vi.fn(response) })('/event/2026xxxx/rankings')
      return { status: result.status, error: (JSON.parse(result.body) as { error: string }).error }
    }
    expect(await error(async () => answer(401))).toEqual({ status: 502, error: expect.stringMatching(/TBA_KEY/) })
    expect(await error(async () => answer(404))).toEqual({ status: 404, error: expect.stringMatching(/event key/) })
    expect(await error(async () => answer(500))).toEqual({ status: 502, error: expect.stringMatching(/\(500\)/) })
    expect(await error(async () => { throw new TypeError('fetch failed') })).toEqual({ status: 502, error: expect.stringMatching(/Couldn't reach/) })
  })

  it('falls back to the last answer when TBA stops answering', async () => {
    let time = 0
    const fetch = vi.fn(async () => answer(200, rankings))
    const ask = createTba('k', { fetch, now: () => time })
    await ask('/event/2026ilch/rankings')
    time = 120_000
    fetch.mockImplementationOnce(async () => { throw new TypeError('fetch failed') })
    expect(await ask('/event/2026ilch/rankings')).toMatchObject({ status: 200, body: rankings })
  })
})
