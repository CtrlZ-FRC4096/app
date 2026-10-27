import { useState, type FormEvent } from 'react'
import { isMentor, useSession } from '../../core/session'
import { useMemberNames } from '../../core/members'
import { toast } from '../../core/toast'
import { shortDate } from '../../core/format'
import { PageHead, Panel } from '../../core/ui'
import { MAX_NOTE_LENGTH, addNote, removeNote, sendMeASlackMessage, useNotes } from './data'

// The page reads data with a hook (useNotes) and changes it with functions
// from data.ts (addNote, removeNote). It never saves anything itself.
export default function ExamplePage() {
  const { role } = useSession()
  const notes = useNotes()
  const nameOf = useMemberNames()
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)
  const [sending, setSending] = useState(false)

  async function post(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    const result = await addNote(text)
    setSaving(false)
    if (!result.ok) {
      toast(result.error)
      return
    }
    setText('')
    toast('Posted.')
  }

  async function remove(id: string) {
    const result = await removeNote(id)
    toast(result.ok ? 'Removed.' : result.error)
  }

  async function slackMe() {
    setSending(true)
    const result = await sendMeASlackMessage()
    setSending(false)
    toast(result.ok ? result.value : result.error)
  }

  return (
    <>
      <PageHead eyebrow="Example module · copy me" title="Team notes">
        A small working module to copy when you start a new one. It saves data, has a form and a list, checks the user's role, and has tests. See src/modules/example/.
      </PageHead>
      <Panel title="Post a note">
        <form className="panel-body" onSubmit={post}>
          <label className="field" htmlFor="note-text">
            Note ({text.trim().length} of {MAX_NOTE_LENGTH})
            <textarea id="note-text" className="input" rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="Something the team should know" />
          </label>
          <div className="toolbar">
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Posting…' : 'Post'}</button>
          </div>
        </form>
      </Panel>
      <Panel title="Notes" aside={<span className="note">{notes.length} posted</span>}>
        {notes.length === 0 ? (
          <p className="panel-body muted">No notes yet. Post the first one above.</p>
        ) : (
          <div className="row-list">
            {notes.map((n) => (
              <div key={n.id}>
                <span>{n.text}<br /><span className="note">{nameOf(n.created_by)} · {shortDate(n.created_at)}</span></span>
                {/* Only mentors and admins see Remove. The database's rules enforce this too. */}
                {isMentor(role) && (
                  <button type="button" className="btn btn-sm" style={{ marginLeft: 'auto' }} onClick={() => void remove(n.id)}>Remove</button>
                )}
              </div>
            ))}
          </div>
        )}
      </Panel>
      <Panel title="Try Slack">
        <div className="panel-body">
          <p className="muted">
            Press the button and the team's Slack bot sends you a direct message. Any module can send Slack messages the same
            way: the page calls a function in data.ts, which calls the slack server function, which holds the bot's key.
          </p>
          <div className="toolbar">
            <button type="button" className="btn" disabled={sending} onClick={() => void slackMe()}>{sending ? 'Sending…' : 'Send me a Slack message'}</button>
          </div>
        </div>
      </Panel>
    </>
  )
}
