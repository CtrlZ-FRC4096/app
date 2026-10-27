/**
 * Reading attendance out of a Slack export, the same way the team's
 * attendance notebook did.
 *
 * A Slack export has users.json (everyone in the workspace) and a folder
 * per channel with one JSON file per day. In the attendance channel:
 *
 *   - Simple Poll posts ask who's coming. Votes for the first option
 *     (:one:) mean yes; votes for any other option mean no.
 *   - The Jibble bot posts "Name jibbled in" and "Name jibbled out".
 *
 * This only reads Slack user IDs, names, times and votes. Everything else
 * in the export (emails, phone numbers, other channels) is left alone and
 * never leaves the browser.
 */
import { teamDay } from './time'

export interface SlackUser {
  id: string
  name: string
  deleted: boolean
  bot: boolean
}

export interface JibbleCheck {
  /** The name Jibble showed, or the Slack ID if Jibble mentioned the person. */
  name: string
  slackUserId: string | null
  direction: 'in' | 'out'
  /** ISO instant. */
  at: string
}

export interface PollVotes {
  /** When the poll was posted (ISO). The answers count for that day. */
  at: string
  yes: string[]
  no: string[]
}

export interface ParsedDay {
  checks: JibbleCheck[]
  polls: PollVotes[]
}

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
const asText = (value: unknown): string => (typeof value === 'string' ? value : '')

/** Everyone in users.json, with the name the notebook used (their real name). */
export function parseUsers(json: unknown): SlackUser[] {
  return asArray(json).filter(isObject).map((user) => {
    const profile = isObject(user.profile) ? user.profile : {}
    const name = (asText(profile.real_name) || asText(user.real_name) || asText(user.name)).trim()
    return { id: asText(user.id), name, deleted: user.deleted === true, bot: user.is_bot === true || asText(user.id) === 'USLACKBOT' }
  }).filter((user) => user.id && user.name)
}

/** Slack's message time ("1736461234.000100", seconds) as an ISO instant. */
export function slackTime(ts: unknown): string {
  return new Date(Number(asText(ts)) * 1000).toISOString()
}

/** The Jibble check-ins and Simple Poll answers in one day file. */
export function parseDay(json: unknown): ParsedDay {
  const checks: JibbleCheck[] = []
  const polls: PollVotes[] = []
  for (const message of asArray(json).filter(isObject)) {
    const at = slackTime(message.ts)
    const check = jibble(message)
    if (check) checks.push({ ...check, at })
    const poll = votes(message)
    if (poll) polls.push({ ...poll, at })
  }
  return { checks, polls }
}

function jibble(message: Json): Omit<JibbleCheck, 'at'> | null {
  if (!message.bot_id && message.subtype !== 'bot_message') return null
  // Jibble's text is in its first block: "Name" then "jibbled in". If the
  // name is a Slack mention instead of text, use the ID it points at.
  let text = ''
  let slackUserId: string | null = null
  const first = asArray(message.blocks)[0]
  const section = isObject(first) ? asArray(first.elements)[0] : undefined
  for (const element of isObject(section) ? asArray(section.elements).filter(isObject) : []) {
    if (element.type === 'user' && !slackUserId) slackUserId = asText(element.user_id)
    text += asText(element.text)
  }
  const found = /^(.*?)\s*jibbled (in|out)\b/i.exec(text.trim()) ?? /^(.*?)\s*jibbled (in|out)\b/i.exec(asText(message.text).trim())
  if (!found) return null
  return { name: found[1].replace(/<@[A-Z0-9]+>/g, '').trim() || slackUserId || '', slackUserId, direction: found[2].toLowerCase() as 'in' | 'out' }
}

function votes(message: Json): Omit<PollVotes, 'at'> | null {
  let found = false
  const yes: string[] = []
  const no: string[] = []
  for (const block of asArray(message.blocks).filter(isObject)) {
    const id = asText(block.block_id).split('-')
    if (id.length <= 2 || id[id.length - 2] !== 'vote') continue
    found = true
    const text = isObject(block.text) ? asText(block.text.text) : ''
    const [first, ...rest] = text.split('\n')
    const voters = [...rest.join('\n').matchAll(/<@([A-Z0-9]+)>/g)].map((m) => m[1])
    ;(first.startsWith(':one:') ? yes : no).push(...voters)
  }
  return found ? { yes, no } : null
}

/**
 * Which Slack user a Jibble name belongs to: an exact match first, then
 * the first two words of their name, then the closest name if it's close
 * enough (like the notebook's difflib.get_close_matches). Active people win
 * over deactivated accounts with the same name.
 */
export function matchName(name: string, users: SlackUser[]): { user: SlackUser; how: 'exact' | 'similar' } | null {
  const people = users.filter((u) => !u.bot).sort((a, b) => Number(a.deleted) - Number(b.deleted))
  const wanted = normalize(name)
  const firstTwo = (s: string) => normalize(s).split(' ').slice(0, 2).join(' ')
  const exact = people.find((u) => normalize(u.name) === wanted) ?? people.find((u) => firstTwo(u.name) === firstTwo(name))
  if (exact) return { user: exact, how: 'exact' }
  let best: SlackUser | null = null
  let bestScore = 0
  for (const user of people) {
    const score = similarity(wanted, normalize(user.name))
    if (score > bestScore) {
      best = user
      bestScore = score
    }
  }
  return best && bestScore >= 0.6 ? { user: best, how: 'similar' } : null
}

const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()

/** How alike two strings are, from 0 to 1 (the same measure as Python's difflib). */
export function similarity(a: string, b: string): number {
  if (!a.length && !b.length) return 1
  return (2 * matching(a, b)) / (a.length + b.length)
}

function matching(a: string, b: string): number {
  let bestLength = 0
  let bestA = 0
  let bestB = 0
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      let k = 0
      while (i + k < a.length && j + k < b.length && a[i + k] === b[j + k]) k++
      if (k > bestLength) {
        bestLength = k
        bestA = i
        bestB = j
      }
    }
  }
  if (bestLength === 0) return 0
  return bestLength + matching(a.slice(0, bestA), b.slice(0, bestB)) + matching(a.slice(bestA + bestLength), b.slice(bestB + bestLength))
}

export interface ExportFile {
  /** The path inside the export, like "attendance/2026-01-09.json" or "users.json". */
  path: string
  text: string
}

export interface ParsedExport {
  users: SlackUser[]
  /** Channel folders that have day files, so the right one can be picked. */
  channels: string[]
  /** Day files for each channel folder. */
  daysByChannel: Map<string, ParsedDay[]>
  /** Files that weren't valid JSON. */
  unreadable: string[]
}

/** Read the files chosen from a Slack export (a whole unzipped folder, or users.json and some day files). */
export function parseExport(files: ExportFile[]): ParsedExport {
  let users: SlackUser[] = []
  const daysByChannel = new Map<string, ParsedDay[]>()
  const unreadable: string[] = []
  for (const file of files) {
    const parts = file.path.split('/')
    const base = parts[parts.length - 1]
    const isUsers = base === 'users.json'
    const isDay = /^\d{4}-\d{2}-\d{2}\.json$/.test(base)
    if (!isUsers && !isDay) continue
    let json: unknown
    try {
      json = JSON.parse(file.text)
    } catch {
      unreadable.push(file.path)
      continue
    }
    if (isUsers) users = parseUsers(json)
    else {
      const channel = parts.length > 1 ? parts[parts.length - 2] : '(chosen files)'
      daysByChannel.set(channel, [...(daysByChannel.get(channel) ?? []), parseDay(json)])
    }
  }
  return { users, channels: [...daysByChannel.keys()].sort(), daysByChannel, unreadable }
}

// ---------------------------------------------------------------------------
// Turning parsed days into people, check-ins and answers. Used by both the
// Import tab and the automatic daily pull (sync.ts).

/** A stable key for a person: their Slack ID, or their name if Jibble's name matched nobody. */
export const slackKey = (id: string) => `slack:${id}`
export const nameKey = (name: string) => `name:${normalize(name)}`

export interface ResolvedPerson {
  slack_user_id: string | null
  name: string
}

export interface Resolved {
  people: Map<string, ResolvedPerson>
  checks: { key: string; direction: 'in' | 'out'; at: string }[]
  /** One answer per person per day: the last poll posted that day counts. */
  rsvps: { key: string; day: string; coming: boolean }[]
  /** Meeting days: any day with a check-in or a poll. */
  days: Set<string>
  /** Jibble names matched to someone by a similar name, to double-check. */
  similar: { jibble: string; slack: string }[]
  /** Jibble names that matched nobody, kept by name. */
  unmatched: string[]
}

export function resolve(users: SlackUser[], days: ParsedDay[]): Resolved {
  const userById = new Map(users.map((u) => [u.id, u]))
  const people = new Map<string, ResolvedPerson>()
  const similar = new Map<string, string>()
  const unmatched = new Set<string>()
  const meetingDays = new Set<string>()
  const add = (key: string, person: ResolvedPerson) => {
    if (!people.has(key)) people.set(key, person)
    return key
  }
  const forSlackId = (id: string) => add(slackKey(id), { slack_user_id: id, name: userById.get(id)?.name ?? id })

  const checks: Resolved['checks'] = []
  for (const check of days.flatMap((d) => d.checks)) {
    meetingDays.add(teamDay(check.at))
    let key: string
    if (check.slackUserId && userById.has(check.slackUserId)) key = forSlackId(check.slackUserId)
    else {
      const match = matchName(check.name, users)
      if (match) {
        key = forSlackId(match.user.id)
        if (match.how === 'similar') similar.set(check.name, match.user.name)
      } else {
        key = add(nameKey(check.name), { slack_user_id: null, name: check.name })
        unmatched.add(check.name)
      }
    }
    checks.push({ key, direction: check.direction, at: check.at })
  }

  const lastPoll = new Map<string, PollVotes>()
  for (const poll of days.flatMap((d) => d.polls)) {
    const day = teamDay(poll.at)
    const current = lastPoll.get(day)
    if (!current || poll.at >= current.at) lastPoll.set(day, poll)
  }
  const answers = new Map<string, Resolved['rsvps'][number]>()
  for (const [day, poll] of lastPoll) {
    meetingDays.add(day)
    for (const id of poll.yes) answers.set(`${id}|${day}`, { key: forSlackId(id), day, coming: true })
    // A "no" vote wins over a "yes" from the same person, as in the notebook.
    for (const id of poll.no) answers.set(`${id}|${day}`, { key: forSlackId(id), day, coming: false })
  }

  return {
    people,
    checks,
    rsvps: [...answers.values()],
    days: meetingDays,
    similar: [...similar].map(([jibble, slack]) => ({ jibble, slack })),
    unmatched: [...unmatched].sort(),
  }
}
