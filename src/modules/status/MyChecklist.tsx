import { useState } from 'react'
import { useSession } from '../../core/session'
import { Bar, Callout, Panel, Pill } from '../../core/ui'
import { checkedIds, myItems, setPitItemCompleted, usePitChecklist, usePitChecks, type PitMatch } from './data'

/** A student's view: only the items assigned to them, checked for the chosen match. */
export function MyChecklist({ match }: { match: PitMatch }) {
  const { id } = useSession()
  const mine = myItems(usePitChecklist(), id)
  const checked = checkedIds(usePitChecks(), match.key)
  const done = mine.filter((item) => checked.has(item.id)).length
  const [error, setError] = useState('')

  if (mine.length === 0) {
    return (
      <Panel title="Your items">
        <p className="panel-body muted" style={{ margin: 0 }}>Nothing on the pit checklist is assigned to you. Ask a student leader or mentor if you should have something.</p>
      </Panel>
    )
  }

  return (
    <>
      {done === mine.length && (
        <Callout title={`You're done for ${match.label}`}>
          <span>Every item assigned to you is checked. Thanks!</span>
        </Callout>
      )}
      <Panel title={`Your items for ${match.label}`} aside={<Pill tone={done === mine.length ? 'ok' : 'plain'}>{done} of {mine.length} done</Pill>}>
        <div className="panel-body">
          <Bar value={done / mine.length} label={`Your items for ${match.label}`} />
        </div>
        <ul className="pit-checklist pit-my-list">
          {mine.map((item) => (
            <li key={item.id}>
              <label className="check pit-item">
                <input type="checkbox" checked={checked.has(item.id)} onChange={async (event) => {
                  const result = await setPitItemCompleted(item.id, match.key, event.target.checked)
                  setError(result.ok ? '' : result.error)
                }} />
                <span className={checked.has(item.id) ? 'pit-item-done' : undefined}>{item.text}</span>
                <span className="pit-subgroup-tag" data-subgroup={item.subgroup}>{item.subgroup}</span>
              </label>
            </li>
          ))}
        </ul>
      </Panel>
      {error && <p role="alert">{error}</p>}
    </>
  )
}
