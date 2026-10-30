// Tests for data.ts. Run them with `npm test`.
// They run in demo mode, and each test starts from the example posts, so
// tests can't affect each other. Who is allowed to do what is the
// database's job: that's tested in supabase/tests/feedback-posts.test.ts.
import { beforeEach, describe, expect, it } from 'vitest'
import {
  MAX_POST_LENGTH,
  addPost,
  checkPost,
  countKind,
  keepKind,
  postsTable,
  removePost,
  summaryText,
  type Kind,
  type Post,
} from './data'

beforeEach(() => {
  postsTable.reset()
})

/** Made-up posts for the counting tests. */
function somePosts(kind: Kind, count: number): Post[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${kind}-${index}`,
    kind,
    text: 'Something to look at',
    created_at: '2026-10-28T00:00:00Z',
    created_by: null,
  }))
}

describe('addPost', () => {
  it('puts a new post at the top of the list, trimmed', async () => {
    const result = await addPost('Idea', '  Label the drawers  ')
    expect(result.ok).toBe(true)
    expect(postsTable.rows()[0]).toMatchObject({ kind: 'Idea', text: 'Label the drawers' })
    expect(postsTable.rows()).toHaveLength(4)
  })

  it('keeps the kind that was chosen', async () => {
    await addPost('Problem', 'The scouting page forgets my last match.')
    expect(postsTable.rows()[0].kind).toBe('Problem')
  })

  it('refuses an empty post and says what to do', async () => {
    expect(await addPost('Idea', '   ')).toEqual({ ok: false, error: 'Write what you want to say first.' })
    expect(postsTable.rows()).toHaveLength(3)
  })

  it('refuses a post that is too long', async () => {
    expect((await addPost('Idea', 'x'.repeat(MAX_POST_LENGTH + 1))).ok).toBe(false)
    expect(postsTable.rows()).toHaveLength(3)
  })
})

describe('checkPost', () => {
  it('allows a post of exactly the longest length', () => {
    expect(checkPost('x'.repeat(MAX_POST_LENGTH))).toBeNull()
  })
})

describe('removePost', () => {
  it('deletes only the post asked for', async () => {
    const [first, ...rest] = postsTable.rows()
    expect(await removePost(first.id)).toEqual({ ok: true, value: null })
    expect(postsTable.rows().map((post) => post.id)).toEqual(rest.map((post) => post.id))
  })

  it('says so if the post is already gone', async () => {
    expect((await removePost('not-a-post')).ok).toBe(false)
  })
})

describe('keepKind', () => {
  it('shows everything when the filter is All', () => {
    expect(keepKind(postsTable.rows(), 'All')).toHaveLength(3)
  })

  it('shows one kind on its own', () => {
    expect(keepKind(postsTable.rows(), 'Problem').map((post) => post.kind)).toEqual(['Problem'])
    expect(keepKind(postsTable.rows(), 'Idea')).toHaveLength(2)
  })
})

describe('countKind', () => {
  it('counts only the kind asked for', () => {
    expect(countKind(postsTable.rows(), 'Idea')).toBe(2)
    expect(countKind(postsTable.rows(), 'Problem')).toBe(1)
  })
})

describe('summaryText', () => {
  it('counts both kinds', () => {
    expect(summaryText([...somePosts('Idea', 2), ...somePosts('Problem', 1)])).toBe('2 ideas · 1 problem')
  })

  it('leaves out a kind nobody has sent', () => {
    expect(summaryText(somePosts('Idea', 1))).toBe('1 idea')
    expect(summaryText(somePosts('Problem', 3))).toBe('3 problems')
  })

  it('says so when nothing has been sent', () => {
    expect(summaryText([])).toBe('Nothing sent yet')
  })
})
