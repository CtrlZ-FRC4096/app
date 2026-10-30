/**
 * Feedback module data: ideas and problems anyone on the team can send.
 *
 * Everyone signed in can send one and read the whole list, so people can
 * see what has already been sent. Mentors and admins can delete a post, and
 * nobody can change one after sending it. Those rules live in the database,
 * in supabase/migrations/..._feedback_posts.sql: hiding the Delete button
 * only keeps the page tidy.
 */
import { createTable, fail, newestFirst, type Result, type Row } from '../../core/table'
import { DEMO_PEOPLE } from '../../core/demo'
import { plural } from '../../core/format'
import { isMentor, type Role } from '../../core/session'
import type { Notice } from '../../core/registry'

/** What a post is about. The database checks the word is one of these. */
export const KINDS = ['Idea', 'Problem'] as const
export type Kind = (typeof KINDS)[number]

/** One row of the feedback_posts table. The fields match its columns. */
export interface Post extends Row {
  kind: Kind
  text: string
  /** Who sent it. Show their name with useMemberNames(). */
  created_by: string | null
}

/** The database allows the same: see the check on the text column. */
export const MAX_POST_LENGTH = 500

const EXAMPLE_POSTS: Post[] = [
  {
    id: '00000000-0000-4000-8000-0000000f0001',
    kind: 'Idea',
    text: 'Put a QR code on every bin so your phone can show what should be in it.',
    created_at: '2026-10-27T22:10:00Z',
    created_by: DEMO_PEOPLE.alex,
  },
  {
    id: '00000000-0000-4000-8000-0000000f0002',
    kind: 'Problem',
    text: 'The pit checklist is hard to tick off with gloves on. The boxes are too small.',
    created_at: '2026-10-26T18:40:00Z',
    created_by: DEMO_PEOPLE.jordan,
  },
  {
    id: '00000000-0000-4000-8000-0000000f0003',
    kind: 'Idea',
    text: 'Show on the home page when the shop is open this week.',
    created_at: '2026-10-25T15:05:00Z',
    created_by: DEMO_PEOPLE.sam,
  },
]

export const postsTable = createTable<Post>('feedback_posts', { demo: EXAMPLE_POSTS, sort: newestFirst })

/** Everything sent, newest first. */
export function usePosts(): Post[] {
  return postsTable.useRows()
}

/** The buttons above the list: everything, or one kind. */
export const FILTERS = ['All', ...KINDS] as const
export type Filter = (typeof FILTERS)[number]

/** The posts the list should show for the chosen button. */
export function keepKind(posts: Post[], filter: Filter): Post[] {
  return filter === 'All' ? posts : posts.filter((post) => post.kind === filter)
}

export function countKind(posts: Post[], kind: Kind): number {
  return posts.filter((post) => post.kind === kind).length
}

/** "2 ideas · 1 problem", for the home page tile and above the list. */
export function summaryText(posts: Post[]): string {
  const ideas = countKind(posts, 'Idea')
  const problems = countKind(posts, 'Problem')
  const parts: string[] = []
  if (ideas > 0) parts.push(plural(ideas, 'idea', 'ideas'))
  if (problems > 0) parts.push(plural(problems, 'problem', 'problems'))
  return parts.length > 0 ? parts.join(' · ') : 'Nothing sent yet'
}

/** The home page tile's status. */
export function useFeedbackSummary(): Notice {
  const posts = usePosts()
  if (countKind(posts, 'Problem') > 0) return { tone: 'warn', text: summaryText(posts) }
  return { tone: posts.length > 0 ? 'info' : 'plain', text: summaryText(posts) }
}

/** Mentors and admins see reported problems under "Needs attention". */
export function useFeedbackAttention(role: Role): Notice[] {
  const posts = usePosts()
  const problems = countKind(posts, 'Problem')
  if (!isMentor(role) || problems === 0) return []
  return [{ tone: 'warn', text: `${plural(problems, 'problem', 'problems')} reported by the team.` }]
}

/** Why a post can't be sent, or null if it can. */
export function checkPost(text: string): string | null {
  const trimmed = text.trim()
  if (!trimmed) return 'Write what you want to say first.'
  if (trimmed.length > MAX_POST_LENGTH) return `Keep it under ${MAX_POST_LENGTH} characters. This one is ${trimmed.length}.`
  return null
}

export async function addPost(kind: Kind, text: string): Promise<Result<Post>> {
  const problem = checkPost(text)
  if (problem) return fail(problem)
  return postsTable.insert({ kind, text: text.trim() })
}

/** Mentors and admins only. The database refuses anyone else. */
export async function removePost(id: string): Promise<Result> {
  return postsTable.remove(id)
}
