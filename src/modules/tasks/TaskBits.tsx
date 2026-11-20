// Small pieces used by both My tasks and the board: the subteam tag, the
// status and Late pills, and the button that moves a task along.
import { useState } from 'react'
import type { Result } from '../../core/table'
import { toast } from '../../core/toast'
import { Pill } from '../../core/ui'
import { STATUS_NAMES, dueText, isLate, moveAlong, moveBack, type Task } from './data'

const STATUS_TONES = { todo: 'plain', in_progress: 'info', done: 'ok' } as const

export function SubteamTag(props: { subteam: string }) {
  return <span className="tasks-subteam-tag" data-subteam={props.subteam}>{props.subteam}</span>
}

/** The task's status, "Late" if it is, and when it's due. */
export function TaskStatusLine(props: { task: Task }) {
  const { task } = props
  const due = dueText(task.due_date)
  return (
    <>
      <Pill tone={STATUS_TONES[task.status]}>{STATUS_NAMES[task.status]}</Pill>
      {isLate(task) && <Pill tone="warn">Late</Pill>}
      {due && <span className="note">{due}</span>}
    </>
  )
}

/**
 * The button that moves a task one step: "Start" at To do, "Mark done" when
 * it's in progress, and "Not done yet" (back to In progress) once it's done,
 * to undo a mis-tap.
 */
export function MoveButton(props: { task: Task; big?: boolean }) {
  const { task } = props
  const [saving, setSaving] = useState(false)
  const done = task.status === 'done'
  const label = done ? 'Not done yet' : task.status === 'todo' ? 'Start' : 'Mark done'

  async function move() {
    setSaving(true)
    const result: Result<Task> = done ? await moveBack(task.id) : await moveAlong(task.id)
    setSaving(false)
    toast(result.ok ? `${STATUS_NAMES[result.value.status]}: ${task.title}` : result.error)
  }

  return (
    <button type="button" className={'btn' + (done ? '' : ' btn-primary') + (props.big ? ' tasks-move' : '')} disabled={saving}
      aria-label={`${label}: ${task.title}`} onClick={() => void move()}>
      {label}
    </button>
  )
}
