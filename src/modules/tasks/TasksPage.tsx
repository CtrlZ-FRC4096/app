import { useState } from 'react'
import { useMemberNames } from '../../core/members'
import { useSession } from '../../core/session'
import { InView, PageHead, Panel, Pick } from '../../core/ui'
import { ALL, SUBTEAMS, canManageTasks, findTasks, useTasks, type Task } from './data'
import { Board } from './Board'
import { MyTasks } from './MyTasks'
import { TaskForm } from './TaskForm'
import './tasks.css'

/**
 * The Task board (#157): My tasks at the top, then the board, with a column
 * for each subteam. Student leaders, mentors and admins add, edit and delete
 * tasks; everyone moves their own along.
 */
export default function TasksPage() {
  const { role } = useSession()
  const tasks = useTasks()
  const nameOf = useMemberNames()
  const [subteam, setSubteam] = useState<string>(ALL)
  const [search, setSearch] = useState('')
  const [showDone, setShowDone] = useState(false)
  // The task being edited, 'new' while adding one, or null when the form is closed.
  const [editing, setEditing] = useState<Task | 'new' | null>(null)
  // The task as it is now. If someone deletes it while the form is open, this
  // is undefined and the form closes.
  const editingTask = editing === 'new' || editing === null ? editing : tasks.find((task) => task.id === editing.id)
  // Done tasks the board would show with Show done on: the same subteam and search.
  const doneCount = findTasks(tasks, search, nameOf).filter((task) => task.status === 'done' && (subteam === ALL || task.subteam === subteam)).length

  return (
    <>
      <PageHead title="Task board">
        Jobs for each subteam that aren't on the BOM or the pit checklist. Move yours along as you go.
      </PageHead>

      <MyTasks />

      <Panel title="The board"
        aside={canManageTasks(role) && (
          <button type="button" className="btn btn-primary tasks-tap" onClick={() => setEditing('new')}>Add a task</button>
        )}>
        <div className="panel-body tasks-filters">
          <div className="field">
            Subteam
            <Pick label="Subteam" options={[ALL, ...SUBTEAMS]} value={subteam} onChange={setSubteam} />
          </div>
          <label className="field" htmlFor="tasks-search">
            Find a task
            <input id="tasks-search" className="input" type="search" value={search} placeholder="A word, or someone's name"
              onChange={(e) => setSearch(e.target.value)} />
          </label>
          <label className="check tasks-tap">
            <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />
            Show done ({doneCount})
          </label>
        </div>
      </Panel>

      {/* The form opens away from Edit on a card far down the page, so it scrolls into view. */}
      {editingTask && (
        <InView key={editingTask === 'new' ? 'new' : editingTask.id}>
          <TaskForm task={editingTask === 'new' ? null : editingTask} startSubteam={subteam} onDone={() => setEditing(null)} />
        </InView>
      )}

      <Board tasks={tasks} subteam={subteam} search={search} showDone={showDone} onEdit={setEditing} />
    </>
  )
}
