import { useState, type FormEvent } from 'react'
import { isMentor, useSession } from '../../core/session'
import { toast } from '../../core/toast'
import { shortDate } from '../../core/format'
import { PageHead, Panel } from '../../core/ui'
import { MAX_NOTE_LENGTH, addNote, removeNote, useNotes } from './data'

// The page reads data with a hook (useNotes) and changes it with functions
// from data.ts (addNote, removeNote). It never saves anything itself.
export default function ExamplePage() {
  const { name, role } = useSession()
  const notes = useNotes()
  const [text, setText] = useState('')

  function post(event: FormEvent) {
    event.preventDefault()
    const result = addNote(text, name)
    if (!result.ok) {
      toast(result.error)
      return
    }
    setText('')
    toast('Posted.')
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
            <button type="submit" className="btn btn-primary">Post</button>
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
                <span>{n.text}<br /><span className="note">{n.author} · {shortDate(n.posted)}</span></span>
                {/* Only mentors and admins see Remove. Once there is a database, its rules enforce this too. */}
                {isMentor(role) && (
                  <button type="button" className="btn btn-sm" style={{ marginLeft: 'auto' }} onClick={() => removeNote(n.id)}>Remove</button>
                )}
              </div>
            ))}
          </div>
        )}
      </Panel>
    </>
  )
}
