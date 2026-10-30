import { useState, type FormEvent } from 'react'
import { isMentor, useSession } from '../../core/session'
import { useMemberNames } from '../../core/members'
import { toast } from '../../core/toast'
import { shortDate } from '../../core/format'
import { PageHead, Panel, Pick, Pill } from '../../core/ui'
import {
  FILTERS,
  KINDS,
  MAX_POST_LENGTH,
  addPost,
  keepKind,
  removePost,
  summaryText,
  usePosts,
  type Filter,
  type Kind,
} from './data'

// The page reads data with a hook (usePosts) and changes it with functions
// from data.ts (addPost, removePost). It never saves anything itself.
export default function FeedbackPage() {
  const { role } = useSession()
  const posts = usePosts()
  const nameOf = useMemberNames()
  const [kind, setKind] = useState<Kind>('Idea')
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [filter, setFilter] = useState<Filter>('All')
  const shown = keepKind(posts, filter)

  async function send(event: FormEvent) {
    event.preventDefault()
    setSending(true)
    const result = await addPost(kind, text)
    setSending(false)
    if (!result.ok) {
      toast(result.error)
      return
    }
    setText('')
    toast('Sent. Thanks!')
  }

  async function remove(id: string) {
    const result = await removePost(id)
    toast(result.ok ? 'Deleted.' : result.error)
  }

  return (
    <>
      <PageHead title="Ideas and feedback">
        Anything that would make the team, the robot or this app better.
      </PageHead>

      <Panel title="Send one">
        {/* Kept to a readable width so the box doesn't stretch across a laptop screen. */}
        <form className="panel-body" style={{ maxWidth: '70ch' }} onSubmit={send}>
          <div className="field">
            <span>What is it?</span>
            <Pick label="What is it?" options={[...KINDS]} value={kind} onChange={setKind} />
          </div>
          <label className="field" htmlFor="feedback-text">
            {kind === 'Idea' ? 'Your idea' : "What's wrong"} ({text.trim().length} of {MAX_POST_LENGTH})
            <textarea
              id="feedback-text"
              className="input"
              rows={3}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={kind === 'Idea' ? 'Something the team should try' : "What happened, and what you'd expect instead"}
            />
          </label>
          <div className="toolbar">
            <button type="submit" className="btn btn-primary" disabled={sending}>{sending ? 'Sending…' : 'Send'}</button>
          </div>
        </form>
      </Panel>

      <Panel title="What people have sent" aside={<span className="note">{summaryText(posts)}</span>}>
        <div className="panel-body">
          <Pick label="Show" options={[...FILTERS]} value={filter} onChange={setFilter} />
        </div>
        {shown.length === 0 ? (
          <p className="panel-body muted">
            {posts.length === 0 ? 'Nothing sent yet. Send the first one above.' : `Nothing filed as a ${filter.toLowerCase()} yet.`}
          </p>
        ) : (
          <div className="row-list">
            {shown.map((post) => (
              <div key={post.id}>
                <Pill tone={post.kind === 'Problem' ? 'warn' : 'info'}>{post.kind}</Pill>
                <span>
                  {post.text}
                  <br />
                  <span className="note">{nameOf(post.created_by)} · {shortDate(post.created_at)}</span>
                </span>
                {/* Only mentors and admins see Delete. The database's rules enforce this too. */}
                {isMentor(role) && (
                  <button type="button" className="btn btn-sm" style={{ marginLeft: 'auto' }} onClick={() => void remove(post.id)}>Delete</button>
                )}
              </div>
            ))}
          </div>
        )}
      </Panel>
    </>
  )
}
