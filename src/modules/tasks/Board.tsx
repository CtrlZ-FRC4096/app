import { useState } from 'react'
import { shortDate } from '../../core/format'
import { useMemberNames } from '../../core/members'
import { useSession } from '../../core/session'
import { toast } from '../../core/toast'
import { Panel } from '../../core/ui'
import { boardSections, canManageTasks, canMoveAlong, findTasks, removeTask, type Task } from './data'
import { MoveButton, SubteamTag, TaskStatusLine } from './TaskBits'

/**
 * The board: one column for each subteam (stacked on a phone), with the
 * tasks that match the filter and search. Done tasks only show with
 * "Show done", the most recently done first.
 */
export function Board(props: { tasks: Task[]; subteam: string; search: string; showDone: boolean; onEdit: (task: Task) => void }) {
  const nameOf = useMemberNames()
  const searching = props.search.trim() !== ''
  const sections = boardSections(findTasks(props.tasks, props.search, nameOf), props.subteam)
    .filter((section) => !searching || section.open.length > 0 || (props.showDone && section.done.length > 0))

  if (searching && sections.length === 0) {
    return <p className="note">No tasks match “{props.search.trim()}”. Try another word{!props.showDone && ', or turn on Show done'}.</p>
  }

  return (
    <div className="tasks-board">
      {sections.map((section) => {
        const shown = props.showDone ? [...section.open, ...section.done] : section.open
        return (
          <Panel key={section.subteam} className="tasks-column"
            title={<h2><SubteamTag subteam={section.subteam} /></h2>}
            aside={
              <span className="note">
                {section.open.length} open{!props.showDone && section.done.length > 0 && ` · ${section.done.length} done`}
              </span>
            }>
            {shown.length === 0 ? (
              <p className="note tasks-empty">
                {section.done.length === 0
                  ? 'No tasks yet.'
                  : `Nothing left to do. Turn on Show done to see the ${section.done.length} done.`}
              </p>
            ) : (
              <ul className="tasks-list">
                {shown.map((task) => <TaskCard key={task.id} task={task} onEdit={props.onEdit} />)}
              </ul>
            )}
          </Panel>
        )
      })}
    </div>
  )
}

/** One task on the board. Students see it read-only unless it's theirs. */
function TaskCard(props: { task: Task; onEdit: (task: Task) => void }) {
  const { task } = props
  const me = useSession()
  const nameOf = useMemberNames()
  const [removing, setRemoving] = useState(false)
  const manage = canManageTasks(me.role)

  async function remove() {
    // Deleting can't be undone, so it takes two presses.
    if (!removing) {
      setRemoving(true)
      return
    }
    const result = await removeTask(task.id)
    toast(result.ok ? `Deleted “${task.title}”.` : result.error)
  }

  return (
    <li className={task.status === 'done' ? 'tasks-done' : undefined}>
      <strong className="tasks-title">{task.title}</strong>
      {task.details && <p className="note tasks-details">{task.details}</p>}
      <div className="tasks-meta">
        <TaskStatusLine task={task} />
      </div>
      <div className="tasks-people" role="group" aria-label="Who it's for">
        {task.assignee_ids.length === 0
          ? <span className="tasks-unassigned">Nobody yet</span>
          : task.assignee_ids.map((id) => <span key={id} className="person-chip">{nameOf(id)}</span>)}
      </div>
      <span className="note">Added by {nameOf(task.created_by)} · {shortDate(task.created_at)}</span>
      {(manage || canMoveAlong(task, me)) && (
        <div className="tasks-actions">
          {canMoveAlong(task, me) && <MoveButton task={task} />}
          {manage && (
            <>
              <button type="button" className="btn" aria-label={`Edit: ${task.title}`} onClick={() => props.onEdit(task)}>Edit</button>
              <button type="button" className="btn" aria-label={removing ? `Press again to delete: ${task.title}` : `Delete: ${task.title}`}
                onClick={() => void remove()} onBlur={() => setRemoving(false)}>
                {removing ? 'Press again to delete' : 'Delete'}
              </button>
            </>
          )}
        </div>
      )}
    </li>
  )
}

