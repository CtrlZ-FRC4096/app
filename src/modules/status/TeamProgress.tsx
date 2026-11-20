import { useMembers } from '../../core/members'
import { Panel, Pill } from '../../core/ui'
import { progressByPerson, uncheckedByPerson, usePitChecklist, usePitChecks, type PitMatch } from './data'

/** For student leaders, mentors and admins: each person's progress for the chosen match, and what's still to do, by who it's assigned to. */
export function TeamProgress({ match }: { match: PitMatch }) {
  const items = usePitChecklist()
  const checks = usePitChecks()
  const members = useMembers()
  const people = progressByPerson(items, checks, match.key, members)
  const left = uncheckedByPerson(items, checks, match.key, members)

  return (
    <>
      <Panel title={`Progress for ${match.label}`}>
        {people.length === 0 ? (
          <p className="panel-body muted" style={{ margin: 0 }}>No items are assigned to anyone yet.</p>
        ) : (
          <div className="row-list">
            {people.map((person) => (
              <div key={person.id}>
                <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{person.name}</span>
                <span style={{ marginLeft: 'auto' }}>
                  <Pill tone={person.done === person.total ? 'ok' : 'plain'}>{person.done} of {person.total}</Pill>
                </span>
              </div>
            ))}
          </div>
        )}
      </Panel>
      <Panel title="Still to do">
        {left.length === 0 ? (
          <p className="panel-body muted" style={{ margin: 0 }}>{items.length ? `Everything is checked for ${match.label}.` : 'No items yet.'}</p>
        ) : (
          <div className="panel-body pit-left">
            {left.map((group) => (
              <div key={group.id ?? 'unassigned'} className={group.id ? undefined : 'pit-unassigned-group'}>
                <strong>{group.name}</strong>
                {!group.id && <span className="note"> · assign these in the full checklist below: tap + Add people, or Select several at once</span>}
                <ul>
                  {group.items.map((item) => <li key={item.id}>{item.text}</li>)}
                </ul>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </>
  )
}
