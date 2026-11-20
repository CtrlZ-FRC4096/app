import { Panel } from '../../core/ui'
import { isLate, useMyTasks } from './data'
import { MoveButton, SubteamTag, TaskStatusLine } from './TaskBits'

/**
 * "My tasks" at the top of the page: the signed-in person's unfinished
 * tasks, soonest due first (so late ones come first), each with a big button
 * to move it along.
 */
export function MyTasks() {
  const tasks = useMyTasks()
  const late = tasks.filter((task) => isLate(task)).length

  return (
    <Panel title="My tasks" aside={tasks.length > 0 && <span className="note">{tasks.length} open{late > 0 && ` · ${late} late`}</span>}>
      {tasks.length === 0 ? (
        <p className="note tasks-empty">Nothing assigned to you. When a student leader or mentor gives you a task, it shows up here.</p>
      ) : (
        <ul className="tasks-list">
          {tasks.map((task) => (
            <li key={task.id}>
              <strong className="tasks-title">{task.title}</strong>
              {task.details && <p className="note tasks-details">{task.details}</p>}
              <div className="tasks-meta">
                <SubteamTag subteam={task.subteam} />
                <TaskStatusLine task={task} />
              </div>
              <div className="tasks-actions">
                <MoveButton task={task} big />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}
