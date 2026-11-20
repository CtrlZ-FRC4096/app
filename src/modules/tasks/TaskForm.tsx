import { useState, type FormEvent } from 'react'
import { useMemberNames, useMembers } from '../../core/members'
import { toast } from '../../core/toast'
import { Panel, PeoplePicker, Pick } from '../../core/ui'
import { DETAILS_LIMIT, SUBTEAMS, TITLE_LIMIT, addTask, editTask, isSubteam, removeTask, type Subteam, type Task } from './data'

/**
 * Add a task, or edit one (`task`), for student leaders, mentors and admins.
 * A new task starts in `startSubteam` (the board's filter). `onDone` closes
 * the form.
 */
export function TaskForm(props: { task: Task | null; startSubteam: string; onDone: () => void }) {
  const { task } = props
  const [title, setTitle] = useState(task?.title ?? '')
  const [details, setDetails] = useState(task?.details ?? '')
  const [subteam, setSubteam] = useState<Subteam>(() => {
    const start = task?.subteam ?? props.startSubteam
    // A task whose subteam is no longer listed starts at General, so it's saved with a listed one.
    return isSubteam(start) ? start : 'General'
  })
  const [dueDate, setDueDate] = useState(task?.due_date ?? '')
  const [people, setPeople] = useState<string[]>(task?.assignee_ids ?? [])
  const [saving, setSaving] = useState(false)
  const [removing, setRemoving] = useState(false)

  const nameOf = useMemberNames()
  // Anyone whose access is on can be given a task. Nobody is listed until a name is typed.
  const pool = useMembers().filter((member) => member.active).map((member) => ({ id: member.id, name: member.name }))
  const chosen = people.map((id) => ({ id, name: nameOf(id) }))

  async function save(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    const fields = { title, details, subteam, assignee_ids: people, due_date: dueDate || null }
    const result = task ? await editTask(task.id, fields) : await addTask(fields)
    setSaving(false)
    toast(result.ok ? (task ? 'Task saved.' : 'Task added.') : result.error)
    if (result.ok) props.onDone()
  }

  async function remove() {
    if (!task) return
    // Deleting can't be undone, so it takes two presses.
    if (!removing) {
      setRemoving(true)
      return
    }
    setSaving(true)
    const result = await removeTask(task.id)
    setSaving(false)
    toast(result.ok ? `Deleted “${task.title}”.` : result.error)
    if (result.ok) props.onDone()
  }

  return (
    <Panel title={task ? 'Edit task' : 'Add a task'}>
      <form className="panel-body tasks-form" onSubmit={save}>
        <label className="field" htmlFor="tasks-title">
          What needs doing ({title.trim().length} of {TITLE_LIMIT})
          <input id="tasks-title" className="input" required autoFocus maxLength={TITLE_LIMIT} value={title}
            placeholder="Sort the hardware bins" onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="field" htmlFor="tasks-details">
          Details (optional)
          <textarea id="tasks-details" className="input" rows={3} maxLength={DETAILS_LIMIT} value={details}
            onChange={(e) => setDetails(e.target.value)} />
        </label>
        <div className="field">
          Subteam
          <Pick label="Subteam" options={[...SUBTEAMS]} value={subteam} onChange={setSubteam} />
        </div>
        <div className="field">
          <label htmlFor="tasks-due">Due date (optional)</label>
          <div className="toolbar">
            <input id="tasks-due" className="input" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            {dueDate && <button type="button" className="btn tasks-tap" onClick={() => setDueDate('')}>No due date</button>}
          </div>
        </div>
        <div className="field">
          People
          <PeoplePicker findId="tasks-people-find" disabled={saving} pool={pool} chosen={chosen} suggestedIds={[]}
            nobody="Nobody to choose from yet: people show up here once they've signed in."
            onAdd={(id) => setPeople((ids) => (ids.includes(id) ? ids : [...ids, id]))}
            onRemove={(id) => setPeople((ids) => ids.filter((other) => other !== id))} />
          <span className="note">Leave it empty if nobody has it yet.</span>
        </div>
        <div className="toolbar">
          <button type="submit" className="btn btn-primary btn-lg" disabled={saving}>{saving ? 'Saving…' : task ? 'Save' : 'Add task'}</button>
          <button type="button" className="btn btn-lg" onClick={props.onDone}>Cancel</button>
          {task && (
            <button type="button" className="btn btn-lg" disabled={saving} onClick={() => void remove()} onBlur={() => setRemoving(false)}>
              {removing ? 'Press again to delete' : 'Delete'}
            </button>
          )}
        </div>
      </form>
    </Panel>
  )
}
