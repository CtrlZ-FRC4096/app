import { plural } from '../../core/format'
import { Panel, Pill } from '../../core/ui'
import { STATUS_NAMES, dueText, stepName } from './data'
import { openItems, useMyWork, type WorkItem } from './work'

const STATUS_TONES = { todo: 'plain', in_progress: 'info', done: 'ok' } as const

/**
 * The "My work" panel at the top of the BOM page (#16): the stages assigned
 * to the signed-in person, grouped To do, In progress and Done, late ones
 * first and marked Late. Done is folded away to start with.
 *
 * It only shows when you have a stage that isn't done. "Show part" calls
 * `onOpen`, which picks the part's system on the page, then scrolls to the
 * part's row (the row has the id `part-<its id>`).
 */
export function MyWork(props: { onOpen: (item: WorkItem) => void }) {
  const groups = useMyWork()
  const open = openItems(groups)
  if (open.length === 0) return null
  const late = open.filter((item) => item.late).length

  function show(item: WorkItem) {
    props.onOpen(item)
    // Wait for the page to draw the part's system, then bring its row into view.
    setTimeout(() => {
      document.getElementById(`part-${item.part.id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }, 0)
  }

  return (
    <Panel
      title="My work"
      aside={<span className="note">{plural(open.length, 'stage', 'stages')} to do{late > 0 && ` · ${late} late`}</span>}
    >
      {groups.map((group) => {
        const list = <WorkList items={group.items} onShow={show} />
        const heading = `${STATUS_NAMES[group.status]} (${group.items.length})`
        // Done stages are folded away, so the list stays about what's left.
        return group.status === 'done' ? (
          <details key={group.status} style={{ borderTop: '1px solid var(--line)' }}>
            <summary style={{ minHeight: 44, padding: '12px 16px', cursor: 'pointer', fontWeight: 600 }}>{heading}</summary>
            {list}
          </details>
        ) : (
          <div key={group.status} style={{ borderTop: '1px solid var(--line)' }}>
            <h3 style={{ margin: 0, padding: '12px 16px 0', fontSize: 15 }}>{heading}</h3>
            {list}
          </div>
        )
      })}
    </Panel>
  )
}

/** One group's stages: the stage, the part's number, name and system, when it's due, and a button to go to the part. */
function WorkList(props: { items: WorkItem[]; onShow: (item: WorkItem) => void }) {
  return (
    <div className="row-list">
      {props.items.map((item) => (
        <div key={item.step.id}>
          {/* minWidth 0 lets long part names wrap on a phone instead of pushing the button off the screen. */}
          <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
            <Pill tone={STATUS_TONES[item.step.status]}>{stepName(item.step)}</Pill>
            {item.late && <> <Pill tone="warn">Late</Pill></>}
            <br />
            <span className="mono">{item.part.part_number}</span> {item.part.name}
            <br />
            <span className="note">
              {item.system.name}
              {item.step.due_date && ` · due ${dueText(item.step.due_date)}`}
            </span>
          </span>
          <button type="button" className="btn" onClick={() => props.onShow(item)}>Show part</button>
        </div>
      ))}
    </div>
  )
}
