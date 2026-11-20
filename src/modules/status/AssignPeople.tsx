import { useEffect, useRef, useState } from 'react'
import { plural } from '../../core/format'
import { useMembers } from '../../core/members'
import { PeoplePicker } from '../../core/ui'
import {
  assignPitItems, assignedText, belongsToSubgroup, notInText, planAssignment, suggestedFor, usePitChecklist, useSubgroupMembers, type PitItem,
} from './data'

/**
 * The People popup for several items at once: Assign people, after Select.
 * As people are chosen, it lists the ticked items it will skip because
 * someone chosen isn't in the item's subgroup. Add puts the people on the
 * rest. Nobody already on an item is taken off, and checks stay. Unlike one
 * item's People popup, nothing saves until Add.
 */
export function AssignPeople(props: { items: PitItem[]; onClose: () => void; onSaved: (message: string, skippedIds: string[]) => void }) {
  const { items, onClose } = props
  const dialog = useRef<HTMLDialogElement>(null)
  const members = useMembers()
  const everyItem = usePitChecklist()
  // Read so who can be chosen, and what's skipped, update when a subgroup's members change.
  useSubgroupMembers()
  const [chosen, setChosen] = useState<string[]>([])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const nameOf = (id: string) => members.find((member) => member.id === id)?.name ?? 'Former member'
  const subgroups = [...new Set(items.map((item) => item.subgroup))]
  // Anyone in at least one ticked item's subgroup: the whole team when a General item is ticked.
  const pool = members.filter((member) => member.active && subgroups.some((group) => belongsToSubgroup(member.id, group)))
  const plan = planAssignment(items, chosen)

  useEffect(() => {
    const element = dialog.current!
    element.showModal()
    element.querySelector<HTMLElement>('#pit-assign-find')?.focus()
    return () => element.close()
  }, [])

  async function add() {
    setSaving(true)
    const result = await assignPitItems(items.map((item) => item.id), chosen)
    setSaving(false)
    if (!result.ok) { setError(result.error); return }
    props.onSaved(assignedText(result.value, chosen, members), result.value.skip.map((skip) => skip.item.id))
    onClose()
  }

  return (
    <dialog ref={dialog} className="pit-popup" aria-labelledby="pit-assign-title" onCancel={onClose}
      onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className="pit-popup-body">
        <div className="pit-popup-head">
          <h2 id="pit-assign-title">Assign people</h2>
          <button className="btn pit-add" type="button" aria-label="Close popup" onClick={onClose}>×</button>
        </div>
        <p className="note">
          Choose who to add to the {plural(items.length, 'ticked item', 'ticked items')}. Nobody already on them is taken off, and checks stay. Nothing saves until you tap Add.
        </p>
        <PeoplePicker findId="pit-assign-find" disabled={saving}
          chosen={chosen.map((id) => ({ id, name: nameOf(id) }))}
          pool={pool}
          suggestedIds={suggestedFor(subgroups, everyItem)}
          nobody={`Nobody is in ${subgroups.join(' or ')} yet. Add people in the Subgroups panel under the checklist.`}
          onAdd={(id) => { setChosen((ids) => (ids.includes(id) ? ids : [...ids, id])); setError('') }}
          onRemove={(id) => { setChosen((ids) => ids.filter((other) => other !== id)); setError('') }} />
        {/* Always here, so screen readers notice when skipped items appear in it. */}
        <div className="pit-skipped" role="status">
          {plan.skip.length > 0 && <>
            <p className="note">These are skipped, and stay ticked:</p>
            <ul>
              {plan.skip.map((skip) => <li key={skip.item.id}>{skip.item.text}: {notInText(skip.notIn, skip.item.subgroup, members)}</li>)}
            </ul>
          </>}
        </div>
        {error && <p role="alert">{error}</p>}
        <div className="toolbar">
          <button type="button" className="btn pit-add" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary pit-add" disabled={saving || !chosen.length || !plan.assign.length} onClick={() => void add()}>
            {saving ? 'Adding…' : `Add to ${plural(plan.assign.length, 'item', 'items')}`}
          </button>
        </div>
      </div>
    </dialog>
  )
}
