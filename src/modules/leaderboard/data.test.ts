// Tests for data.ts. Run them with `npm test`. They run in demo mode, and
// never ask the real GitHub: fetchMergedPulls() gets a pretend one.
import { describe, expect, it } from 'vitest'
import { FRESH_MINUTES, closedIssues, fetchMergedPulls, isFresh, leaderboards, rank, updateLeaderboards, type MergedPull } from './data'

describe('closedIssues', () => {
  it('finds the issues closed with GitHub’s closing words, each once', () => {
    const cases: [string | null, number[]][] = [
      ['Closes #218\nCloses #219', [218, 219]],
      ['fixes #5 and resolved #6', [5, 6]],
      ['Fix: #7', [7]],
      ['Closed #8, closes #8 again', [8]],
      ['Closing #9', []],
      ['Depends on #247', []],
      ['Step 1 of #65', []],
      ['Closes other/repo#3', []],
      ['', []],
      [null, []],
    ]
    for (const [body, expected] of cases) expect(closedIssues(body), String(body)).toEqual(expected)
  })
})

describe('rank', () => {
  it('puts the most first, breaks ties by name, shares ranks on ties, and leaves out zeros', () => {
    const counts = new Map([['cam', 2], ['ana', 5], ['bea', 2], ['dev', 1], ['eli', 0]])
    expect(rank(counts)).toEqual([
      { rank: 1, login: 'ana', count: 5 },
      { rank: 2, login: 'bea', count: 2 },
      { rank: 2, login: 'cam', count: 2 },
      { rank: 4, login: 'dev', count: 1 },
    ])
  })
})

describe('leaderboards', () => {
  it('counts each person’s merged pull requests and the different issues they closed', () => {
    const pulls: MergedPull[] = [
      { number: 1, author: 'ana', mergedAt: '', closes: [10, 11] },
      { number: 2, author: 'ana', mergedAt: '', closes: [11] },
      { number: 3, author: 'bea', mergedAt: '', closes: [] },
    ]
    expect(leaderboards(pulls, [])).toEqual({
      pulls: [{ rank: 1, login: 'ana', count: 2 }, { rank: 2, login: 'bea', count: 1 }],
      issues: [{ rank: 1, login: 'ana', count: 2 }],
    })
  })
})

describe('mentors', () => {
  it('leaves mentors off both boards, whatever the capitals in their username', () => {
    const pulls: MergedPull[] = [
      { number: 1, author: 'Pat-Mentor', mergedAt: '', closes: [10] },
      { number: 2, author: 'ana', mergedAt: '', closes: [11] },
    ]
    const boards = leaderboards(pulls, ['pat-mentor'])
    expect(boards.pulls.map((p) => p.login)).toEqual(['ana'])
    expect(boards.issues.map((p) => p.login)).toEqual(['ana'])
  })
})

describe('isFresh', () => {
  it('uses a saved copy for FRESH_MINUTES, then asks again', () => {
    const now = 1_000_000_000
    const cases: [number | null, boolean][] = [
      [null, false],
      [now, true],
      [now - (FRESH_MINUTES * 60 * 1000 - 1), true],
      [now - FRESH_MINUTES * 60 * 1000, false],
    ]
    for (const [fetchedAt, expected] of cases) expect(isFresh(fetchedAt, now), String(fetchedAt)).toBe(expected)
  })
})

/** A pretend GitHub that answers each page in turn, and remembers what was asked. */
function pretendGitHub(pages: unknown[][]) {
  const asked: string[] = []
  const get = (async (url: string) => {
    asked.push(url)
    return Response.json(pages[asked.length - 1] ?? [])
  }) as typeof fetch
  return { get, asked }
}

function pull(number: number, login: string, merged: boolean, body = '', type = 'User') {
  return { number, user: { login, type }, merged_at: merged ? '2026-11-01T00:00:00Z' : null, body }
}

describe('fetchMergedPulls', () => {
  it('reads every page, keeping merged pull requests by people', async () => {
    const full = Array.from({ length: 100 }, (_, i) => pull(200 - i, 'ana', true))
    const { get, asked } = pretendGitHub([
      full,
      [pull(3, 'bea', true, 'Closes #2'), pull(2, 'cam', false), pull(1, 'dependabot[bot]', true, '', 'Bot'), { ...pull(0, 'x', true), user: null }],
    ])
    const result = await fetchMergedPulls(get)
    expect(asked).toHaveLength(2)
    expect(asked[1]).toContain('page=2')
    expect(result.ok && result.value).toHaveLength(101)
    expect(result.ok && result.value.at(-1)).toEqual({ number: 3, author: 'bea', mergedAt: '2026-11-01T00:00:00Z', closes: [2] })
  })

  it('says what to do when GitHub can’t be reached or says no', async () => {
    const reset = String(Date.UTC(2026, 10, 17, 21, 0) / 1000)
    const cases: [typeof fetch, RegExp][] = [
      [(() => Promise.reject(new TypeError('Failed to fetch'))) as typeof fetch, /reach github.*try again/i],
      [(async () => new Response('', { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': reset } })) as typeof fetch, /too many requests.*try again after/i],
      [(async () => new Response('', { status: 429 })) as typeof fetch, /too many requests.*in an hour/i],
      [(async () => new Response('', { status: 500 })) as typeof fetch, /problem \(500\).*try again/i],
    ]
    for (const [get, message] of cases) {
      const result = await fetchMergedPulls(get)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toMatch(message)
    }
  })
})

describe('updateLeaderboards', () => {
  it('asks nothing of GitHub in demo mode', async () => {
    const { get, asked } = pretendGitHub([])
    const result = await updateLeaderboards(get)
    expect(result.ok && result.value).toMatch(/demo mode/i)
    expect(asked).toEqual([])
  })
})
