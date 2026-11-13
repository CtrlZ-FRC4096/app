// Tests for what the match13 server function asks Match 13
// (supabase/functions/match13/match13.ts). No network: fetch is faked.
import { describe, expect, it, vi } from 'vitest'
import { createMatch13, match13Path, MATCH13_API } from '../functions/match13/match13.ts'

describe('match13Path', () => {
  it('allows the two things scouting needs', () => {
    expect(match13Path({ kind: 'ratings', event: '2026ilch' })).toEqual({ path: '/v1/events/2026ilch/teams' })
    expect(match13Path({ kind: 'predictions', event: '2026ilch' })).toEqual({ path: '/v1/events/2026ilch/matches' })
  })

  it("allows the event's simulation (#152) and a team's events in a season (#153)", () => {
    expect(match13Path({ kind: 'sim', event: '2026ilch' })).toEqual({ path: '/v1/events/2026ilch/sim' })
    expect(match13Path({ kind: 'team-events', team: 4096, year: 2026 })).toEqual({ path: '/v1/teams/4096/years/2026/events' })
  })

  it("refuses a team's events with a team or year that isn't one", () => {
    for (const bad of [{ team: '4096', year: 2026 }, { team: 0, year: 2026 }, { team: 4096.5, year: 2026 }, { team: 4096, year: 26 }, { team: 4096 }, { team: '1/../../account', year: 2026 }]) {
      expect(match13Path({ kind: 'team-events', ...bad }), JSON.stringify(bad)).toHaveProperty('error')
    }
  })

  it("refuses anything else, so the key can't be used for other requests", () => {
    expect(match13Path({ kind: 'account', event: '2026ilch' })).toHaveProperty('error')
    expect(match13Path({ kind: 'sim' })).toHaveProperty('error')
    expect(match13Path(null)).toHaveProperty('error')
    expect(match13Path({ kind: 'ratings' })).toHaveProperty('error')
    expect(match13Path({ kind: 'ratings', event: '../../account' })).toHaveProperty('error')
    expect(match13Path({ kind: 'ratings', event: '2026ILCH' })).toHaveProperty('error')
    expect(match13Path({ kind: 'predictions', event: '2026ilch?scope=all' })).toHaveProperty('error')
  })
})

describe('createMatch13', () => {
  const teams = '{"eventKey":"2026ilch","teams":[],"year":2026}'
  const answer = (status: number, body = '') => new Response(body, { status })

  it('sends the key, and passes the answer on', async () => {
    const fetch = vi.fn(async () => answer(200, teams))
    const ask = createMatch13('m13_test', { fetch })
    expect(await ask('/v1/events/2026ilch/teams')).toMatchObject({ status: 200, body: teams })
    expect(fetch).toHaveBeenCalledWith(`${MATCH13_API}/v1/events/2026ilch/teams`, {
      headers: { Authorization: 'Bearer m13_test', Accept: 'application/json' },
    })
  })

  it('reuses an answer for two minutes, then asks again', async () => {
    let time = 0
    const fetch = vi.fn(async () => answer(200, teams))
    const ask = createMatch13('k', { fetch, now: () => time })
    await ask('/v1/events/2026ilch/teams')
    time = 119_000
    await ask('/v1/events/2026ilch/teams')
    expect(fetch).toHaveBeenCalledTimes(1)
    time = 121_000
    await ask('/v1/events/2026ilch/teams')
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('says what went wrong: a bad key, an unknown event, too many requests, or Match 13 being down', async () => {
    const error = async (response: () => Promise<Response>) => {
      const result = await createMatch13('k', { fetch: vi.fn(response) })('/v1/events/2026xxxx/teams')
      return { status: result.status, error: (JSON.parse(result.body) as { error: string }).error }
    }
    expect(await error(async () => answer(401))).toEqual({ status: 502, error: expect.stringMatching(/MATCH13_KEY/) })
    expect(await error(async () => answer(404))).toEqual({ status: 404, error: expect.stringMatching(/EVENT_KEY/) })
    expect(await error(async () => answer(429))).toEqual({ status: 503, error: expect.stringMatching(/too many times/) })
    expect(await error(async () => answer(500))).toEqual({ status: 502, error: expect.stringMatching(/\(500\)/) })
    expect(await error(async () => { throw new TypeError('fetch failed') })).toEqual({ status: 502, error: expect.stringMatching(/Couldn't reach/) })
  })

  it('falls back to the last answer when Match 13 stops answering or says to slow down', async () => {
    let time = 0
    const fetch = vi.fn(async () => answer(200, teams))
    const ask = createMatch13('k', { fetch, now: () => time })
    await ask('/v1/events/2026ilch/teams')
    time = 200_000
    fetch.mockImplementationOnce(async () => { throw new TypeError('fetch failed') })
    expect(await ask('/v1/events/2026ilch/teams')).toMatchObject({ status: 200, body: teams })
    time = 400_000
    fetch.mockImplementationOnce(async () => answer(429))
    expect(await ask('/v1/events/2026ilch/teams')).toMatchObject({ status: 200, body: teams })
  })
})
