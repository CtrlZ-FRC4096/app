// Tests for the nexus server function's parts that don't need Deno or a
// network (#165): what it allows the app to ask Nexus, and how it asks.
import { describe, expect, it, vi } from 'vitest'
import { createNexus, nexusPath, NEXUS_API } from '../functions/nexus/nexus.ts'

describe('nexusPath', () => {
  it("allows one event's live status", () => {
    expect(nexusPath({ kind: 'status', event: '2026ilch' })).toEqual({ path: '/event/2026ilch' })
  })

  it("refuses anything else, so the key can't be used for other requests", () => {
    expect(nexusPath(null)).toHaveProperty('error')
    expect(nexusPath({ kind: 'events' })).toHaveProperty('error')
    expect(nexusPath({ kind: 'status' })).toHaveProperty('error')
    expect(nexusPath({ kind: 'status', event: '../../account' })).toHaveProperty('error')
    expect(nexusPath({ kind: 'status', event: '2026ILCH' })).toHaveProperty('error')
    expect(nexusPath({ kind: 'status', event: '2026ilch?all=1' })).toHaveProperty('error')
  })
})

describe('createNexus', () => {
  const status = '{"eventKey":"2026ilch","nowQueuing":"Qualification 18","matches":[]}'
  const answer = (code: number, body = '') => new Response(body, { status: code })

  it('sends the key, and passes the answer on', async () => {
    const fetch = vi.fn(async () => answer(200, status))
    const ask = createNexus('nexus_test', { fetch })
    expect(await ask('/event/2026ilch')).toMatchObject({ status: 200, body: status })
    expect(fetch).toHaveBeenCalledWith(`${NEXUS_API}/event/2026ilch`, { headers: { 'Nexus-Api-Key': 'nexus_test', Accept: 'application/json' } })
  })

  it('reuses an answer for 30 seconds, then asks again', async () => {
    let time = 0
    const fetch = vi.fn(async () => answer(200, status))
    const ask = createNexus('k', { fetch, now: () => time })
    await ask('/event/2026ilch')
    time = 29_000
    await ask('/event/2026ilch')
    expect(fetch).toHaveBeenCalledTimes(1)
    time = 31_000
    await ask('/event/2026ilch')
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('says what went wrong: a bad key, an event Nexus doesn’t have, too many requests, or Nexus being down', async () => {
    const error = async (response: () => Promise<Response>) => {
      const result = await createNexus('k', { fetch: vi.fn(response) })('/event/2026xxxx')
      return { status: result.status, error: (JSON.parse(result.body) as { error: string }).error }
    }
    expect(await error(async () => answer(401))).toEqual({ status: 502, error: expect.stringMatching(/NEXUS_KEY/) })
    expect(await error(async () => answer(403))).toEqual({ status: 502, error: expect.stringMatching(/NEXUS_KEY/) })
    expect(await error(async () => answer(404))).toEqual({ status: 404, error: expect.stringMatching(/doesn't have this event/) })
    expect(await error(async () => answer(429))).toEqual({ status: 503, error: expect.stringMatching(/too many times/) })
    expect(await error(async () => answer(500))).toEqual({ status: 502, error: expect.stringMatching(/\(500\)/) })
    expect(await error(async () => { throw new TypeError('fetch failed') })).toEqual({ status: 502, error: expect.stringMatching(/Couldn't reach/) })
  })

  it('falls back to the last answer when Nexus stops answering', async () => {
    let time = 0
    const fetch = vi.fn(async () => answer(200, status))
    const ask = createNexus('k', { fetch, now: () => time })
    await ask('/event/2026ilch')
    time = 60_000
    fetch.mockImplementationOnce(async () => { throw new TypeError('fetch failed') })
    expect(await ask('/event/2026ilch')).toMatchObject({ status: 200, body: status })
  })
})
