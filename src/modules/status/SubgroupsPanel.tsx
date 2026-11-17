import { useEffect, useRef, useState } from 'react'
import { useMembers } from '../../core/members'
import { Panel, PeoplePicker } from '../../core/ui'
import { PIT_SUBGROUPS, setSubgroupMembers, useSubgroupMembers, type PitSubgroup } from './data'

/**
 * Who's in each subgroup, for student leaders, mentors and admins: one row
 * per subgroup with its people as name tags. Tap a row to change them in
 * the same People picker the items use. Saved on this device (see the
 * README). General isn't here: it's always everyone.
 */
export function SubgroupsPanel(props: { onSaved: (message: string) => void }) {
  const members = useMembers()
  const groups = useSubgroupMembers()
  const [editing, setEditing] = useState<PitSubgroup | null>(null)
  const nameOf = (id: string) => members.find((member) => member.id === id)?.name ?? 'Former member'

  return (
    <Panel title="Subgroups">
      <p className="panel-body note" style={{ margin: 0 }}>
        Who can be given each subgroup's items. Saved on this device only. General items can go to anyone.
      </p>
      <ul className="pit-subgroups">
        {PIT_SUBGROUPS.filter((group) => group !== 'General').map((group) => {
          const ids = groups[group]
          return (
            <li key={group}>
              <button type="button" className="pit-people" aria-label={`Change who's in ${group}`} onClick={() => setEditing(group)}>
                <span className="pit-subgroup-tag" data-subgroup={group}>{group}</span>
                {ids === undefined && <span className="note">Everyone, until you choose</span>}
                {ids?.length === 0 && <span className="person-chip pit-chip-add">+ Add people</span>}
                {ids?.map((id) => <span key={id} className="person-chip">{nameOf(id)}</span>)}
              </button>
            </li>
          )
        })}
      </ul>
      {editing && <SubgroupPopup key={editing} group={editing} onClose={() => setEditing(null)} onSaved={props.onSaved} />}
    </Panel>
  )
}

function SubgroupPopup(props: { group: PitSubgroup; onClose: () => void; onSaved: (message: string) => void }) {
  const { group, onClose } = props
  const dialog = useRef<HTMLDialogElement>(null)
  const members = useMembers()
  const active = members.filter((member) => member.active)
  const ids = useSubgroupMembers()[group] ?? []
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const element = dialog.current!
    element.showModal()
    element.querySelector<HTMLElement>('#pit-subgroup-find')?.focus()
    return () => element.close()
  }, [])

  async function save(next: string[]) {
    setSaving(true)
    const result = await setSubgroupMembers(group, next)
    setSaving(false)
    setError(result.ok ? '' : result.error)
    if (result.ok) props.onSaved(`${group} members saved.`)
  }

  return (
    <dialog ref={dialog} className="pit-popup" aria-labelledby="pit-subgroup-title" onCancel={onClose}
      onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className="pit-popup-body">
        <div className="pit-popup-head">
          <h2 id="pit-subgroup-title">{group} members</h2>
          <button className="btn pit-add" type="button" aria-label="Close popup" onClick={onClose}>×</button>
        </div>
        <p className="note" style={{ margin: 0 }}>Changes save straight away. Taking someone out also takes them off {group} items.</p>
        <PeoplePicker findId="pit-subgroup-find" disabled={saving}
          chosen={ids.map((id) => ({ id, name: members.find((member) => member.id === id)?.name ?? 'Former member' }))}
          pool={active}
          onAdd={(id) => void save([...ids.filter((old) => active.some((member) => member.id === old)), id])}
          onRemove={(id) => void save(ids.filter((old) => old !== id && active.some((member) => member.id === old)))} />
        {error && <p role="alert" style={{ margin: 0 }}>{error}</p>}
        <div className="toolbar">
          <button type="button" className="btn btn-primary pit-add" onClick={onClose}>Done</button>
        </div>
      </div>
    </dialog>
  )
}
