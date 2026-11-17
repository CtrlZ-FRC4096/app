/**
 * Leaderboard data: who has merged the most pull requests into the team
 * app's GitHub repo, and who has solved the most issues.
 *
 * Where the numbers come from:
 *   - The repo is public, so the browser asks GitHub's API for its closed
 *     pull requests directly. No key is needed, so there's no server
 *     function and no database table.
 *   - Only merged pull requests count. Closed without merging doesn't.
 *   - An issue counts as solved by the author of the merged pull request
 *     that closes it, using GitHub's own closing words in the pull
 *     request's description: "Closes #12", "Fixes #12" or "Resolves #12".
 *
 * GitHub only answers 60 requests an hour from one network without a key,
 * and the whole school shares one. So the answer is saved on the device and
 * only asked for again after FRESH_MINUTES (or when someone taps Refresh).
 *
 * In demo mode (your computer and the tests) nothing is asked of GitHub:
 * the page shows the made-up pull requests below.
 */
import { useEffect, useMemo } from 'react'
import { createStore, useStore } from '../../core/store'
import { isLive } from '../../core/supabase'
import { fail, ok, type Result } from '../../core/table'

/** The repo the leaderboards count. */
export const REPO = 'CtrlZ-FRC4096/app'

/**
 * Mentors' GitHub usernames. The leaderboards are for students, so these
 * people are left off both boards. GitHub doesn't know who's a mentor, so
 * add a new mentor's username here. Capitals don't matter.
 */
export const MENTOR_LOGINS = ['MBimrose']

/** How long a saved copy is used before asking GitHub again. */
export const FRESH_MINUTES = 15

/** GitHub sends at most 100 pull requests a page. 10 pages is the newest 1000. */
const PAGE_SIZE = 100
const MAX_PAGES = 10

/** A merged pull request, with only what the leaderboards need. */
export interface MergedPull {
  number: number
  /** The GitHub username of who opened it. */
  author: string
  mergedAt: string
  /** The issues its description closes. */
  closes: number[]
}

/** One person's place on a leaderboard. People with the same count share a rank. */
export interface Place {
  rank: number
  login: string
  count: number
}

export interface Leaderboards {
  pulls: Place[]
  issues: Place[]
}

/** Made-up example pull requests for demo mode. The usernames aren't real people. */
export const DEMO_PULLS: MergedPull[] = [
  { number: 41, author: 'demo-alex', mergedAt: '2026-11-10T20:00:00Z', closes: [12, 13] },
  { number: 42, author: 'demo-alex', mergedAt: '2026-11-11T20:00:00Z', closes: [15] },
  { number: 43, author: 'demo-jordan', mergedAt: '2026-11-11T22:00:00Z', closes: [14] },
  { number: 44, author: 'demo-sam', mergedAt: '2026-11-12T19:00:00Z', closes: [] },
  { number: 45, author: 'demo-jordan', mergedAt: '2026-11-13T21:00:00Z', closes: [16] },
  { number: 46, author: 'demo-casey', mergedAt: '2026-11-14T18:00:00Z', closes: [17] },
  { number: 47, author: 'demo-alex', mergedAt: '2026-11-15T20:00:00Z', closes: [] },
]

// ---------------------------------------------------------------------------
// The rules

/**
 * The issue numbers a pull request's description closes, in the order
 * written, each once. Uses GitHub's closing words (close, closes, closed,
 * fix, fixes, fixed, resolve, resolves, resolved), so the leaderboard
 * agrees with what GitHub actually closed. "Closing #12" or "Part of #12"
 * don't close anything, so they don't count.
 */
export function closedIssues(body: string | null): number[] {
  if (!body) return []
  const found = body.matchAll(/\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?):?\s+#(\d+)\b/gi)
  return [...new Set([...found].map((match) => Number(match[1])))]
}

/** Count per person, most first, then by name. People with the same count share a rank: 1, 1, 3. */
export function rank(counts: Map<string, number>): Place[] {
  const sorted = [...counts]
    .filter(([, count]) => count > 0)
    .sort(([a, x], [b, y]) => y - x || a.localeCompare(b))
  return sorted.map(([login, count]) => ({
    rank: sorted.findIndex(([, other]) => other === count) + 1,
    login,
    count,
  }))
}

/** Whether a GitHub username is in `mentors`, whatever its capitals. */
export function isMentorLogin(login: string, mentors: string[] = MENTOR_LOGINS): boolean {
  return mentors.some((mentor) => mentor.toLowerCase() === login.toLowerCase())
}

/**
 * Both leaderboards from the merged pull requests, leaving out mentors. An
 * issue counts once per person, even if several of their pull requests
 * close it.
 */
export function leaderboards(pulls: MergedPull[], mentors: string[] = MENTOR_LOGINS): Leaderboards {
  const pullCounts = new Map<string, number>()
  const issuesBy = new Map<string, Set<number>>()
  for (const pull of pulls) {
    if (isMentorLogin(pull.author, mentors)) continue
    pullCounts.set(pull.author, (pullCounts.get(pull.author) ?? 0) + 1)
    const issues = issuesBy.get(pull.author) ?? new Set<number>()
    pull.closes.forEach((issue) => issues.add(issue))
    issuesBy.set(pull.author, issues)
  }
  const issueCounts = new Map([...issuesBy].map(([login, issues]) => [login, issues.size]))
  return { pulls: rank(pullCounts), issues: rank(issueCounts) }
}

/** Whether a copy fetched at `fetchedAt` is recent enough to use without asking GitHub again. */
export function isFresh(fetchedAt: number | null, now: number): boolean {
  return fetchedAt !== null && now - fetchedAt < FRESH_MINUTES * 60 * 1000
}

// ---------------------------------------------------------------------------
// Asking GitHub

/** The parts of GitHub's answer for one pull request that we read. */
interface GitHubPull {
  number: number
  user: { login: string; type: string } | null
  merged_at: string | null
  body: string | null
}

/** What to tell the person when GitHub says no. */
function explainGitHubError(answer: Response): string {
  const rateLimited = answer.status === 429 || (answer.status === 403 && answer.headers.get('x-ratelimit-remaining') === '0')
  if (rateLimited) {
    const reset = Number(answer.headers.get('x-ratelimit-reset'))
    const when = reset ? `after ${new Date(reset * 1000).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : 'in an hour'
    return `GitHub has had too many requests from this network for now. Try again ${when}.`
  }
  return `GitHub had a problem (${answer.status}). Try again in a minute.`
}

/**
 * Every merged pull request in REPO, newest first, from GitHub. Pull
 * requests by bots, and by deleted accounts, are left out.
 *
 * @param get  How to fetch. Tests pass a pretend GitHub.
 */
export async function fetchMergedPulls(get: typeof fetch = fetch): Promise<Result<MergedPull[]>> {
  const merged: MergedPull[] = []
  for (let page = 1; page <= MAX_PAGES; page++) {
    let answer: Response
    try {
      answer = await get(`https://api.github.com/repos/${REPO}/pulls?state=closed&per_page=${PAGE_SIZE}&page=${page}`, {
        headers: { Accept: 'application/vnd.github+json' },
      })
    } catch {
      return fail("Couldn't reach GitHub. Check your connection and try again.")
    }
    if (!answer.ok) return fail(explainGitHubError(answer))
    const pulls = (await answer.json()) as GitHubPull[]
    for (const pull of pulls) {
      if (!pull.merged_at || !pull.user || pull.user.type === 'Bot') continue
      merged.push({ number: pull.number, author: pull.user.login, mergedAt: pull.merged_at, closes: closedIssues(pull.body) })
    }
    if (pulls.length < PAGE_SIZE) break
  }
  return ok(merged)
}

// ---------------------------------------------------------------------------
// Saving the answer on this device, and the hook the page uses

interface Saved {
  fetchedAt: number
  pulls: MergedPull[]
}

/** The last answer from GitHub, saved on this device so the page doesn't ask every time. */
export const savedPulls = createStore<Saved | null>('leaderboard-pulls', 1, () => null)

/** Whether GitHub is being asked right now, and what went wrong last time. Not saved. */
const status = createStore<{ loading: boolean; error: string | null }>('leaderboard-status', 1, () => ({ loading: false, error: null }), {
  persist: false,
})

let asking: Promise<Result<string>> | null = null

/**
 * Ask GitHub for the newest numbers and save them. The answer is what to
 * tell the person. If it's already asking, this waits for that instead of
 * asking twice.
 */
export function updateLeaderboards(get: typeof fetch = fetch): Promise<Result<string>> {
  if (!isLive) return Promise.resolve(ok('Demo mode: these are made-up people. On the live site the numbers come from GitHub.'))
  if (asking) return asking
  status.set({ loading: true, error: null })
  asking = fetchMergedPulls(get).then((result) => {
    asking = null
    if (result.ok) savedPulls.set({ fetchedAt: Date.now(), pulls: result.value })
    status.set({ loading: false, error: result.ok ? null : result.error })
    return result.ok ? ok('Up to date.') : result
  })
  return asking
}

export interface LeaderboardView extends Leaderboards {
  /** When the numbers came from GitHub, or null if they haven't yet. */
  updatedAt: number | null
  loading: boolean
  error: string | null
  demo: boolean
}

const NONE: MergedPull[] = []

/** Both leaderboards. Asks GitHub when the saved copy is missing or old. */
export function useLeaderboards(): LeaderboardView {
  const saved = useStore(savedPulls)
  const { loading, error } = useStore(status)
  useEffect(() => {
    if (isLive && !isFresh(savedPulls.get()?.fetchedAt ?? null, Date.now())) {
      void updateLeaderboards()
    }
  }, [])
  const pulls = isLive ? (saved?.pulls ?? NONE) : DEMO_PULLS
  const boards = useMemo(() => leaderboards(pulls), [pulls])
  return { ...boards, updatedAt: isLive ? (saved?.fetchedAt ?? null) : null, loading, error, demo: !isLive }
}
