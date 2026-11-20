import { useEffect, useRef, useState } from 'react'
import { useMembers } from '../../core/members'
import { PeoplePicker } from '../../core/ui'
import {
  MAX_ITEM_LENGTH, PIT_SUBGROUPS, assignPitItem, belongsToSubgroup, removePitItem, renamePitItem, setPitItemSubgroup, suggestedFor, usePitChecklist,
  type PitItem,
} from './data'

export type ItemPopupMode = 'subgroup' | 'rename' | 'remove' | 'people'

const TITLES: Record<ItemPopupMode, string> = { subgroup: 'Choose subgroup', rename: 'Rename item', remove: 'Remove item', people: 'People' }

export function ItemPopup({ item, mode, onClose, onSaved }: {
  item: PitItem
  mode: ItemPopupMode
  onClose: () => void
  onSaved: (message: string) => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [text, setText] = useState(item.text)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const element = dialog.current!
    element.showModal()
    element.querySelector<HTMLElement>('#pit-popup-name, #pit-people-find, [aria-pressed="true"]')?.focus()
    return () => element.close()
  }, [])

  /** Save a change; close with a message when it works, or show why it didn't. */
  async function save(change: Promise<{ ok: true } | { ok: false; error: string }>, message: string) {
    setSaving(true)
    const result = await change
    setSaving(false)
    if (!result.ok) { setError(result.error); return }
    onSaved(message)
    onClose()
  }

  return (
    <dialog ref={dialog} className="pit-popup" aria-labelledby="pit-popup-title" onCancel={onClose}
      onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className="pit-popup-body">
        <div className="pit-popup-head">
          <h2 id="pit-popup-title">{TITLES[mode]}</h2>
          <button className="btn pit-add" type="button" aria-label="Close popup" onClick={onClose}>×</button>
        </div>
        {mode === 'subgroup' && <>
          <p className="note">{item.text} · Select a subgroup to save immediately.</p>
          <div className="pit-subgroup-options">
            {PIT_SUBGROUPS.map((group) => <button key={group} type="button" className="btn pit-subgroup-option" disabled={saving}
              autoFocus={group === item.subgroup} aria-pressed={group === item.subgroup}
              onClick={() => void save(setPitItemSubgroup(item.id, group), 'Subgroup saved.')}>
              <span className="pit-subgroup-tag" data-subgroup={group}>{group}</span>
              {group === item.subgroup && <span aria-hidden="true">✓</span>}
            </button>)}
          </div>
        </>}
        {mode === 'rename' && <form className="stack" onSubmit={(event) => {
          event.preventDefault()
          void save(renamePitItem(item.id, text), 'Checklist item renamed.')
        }}>
          <label className="field" htmlFor="pit-popup-name">
            Item name
            <input autoFocus id="pit-popup-name" className="input" maxLength={MAX_ITEM_LENGTH} value={text}
              onChange={(event) => { setText(event.target.value); setError('') }} aria-invalid={!!error}
              aria-describedby={error ? 'pit-popup-error' : undefined} />
          </label>
          <div className="toolbar">
            <button type="button" className="btn pit-add" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary pit-add" disabled={saving}>Rename</button>
          </div>
        </form>}
        {mode === 'remove' && <>
          <p>Remove “{item.text}”? It comes off the checklist for everyone, with its checks for every match. This can't be undone.</p>
          <div className="toolbar">
            <button type="button" className="btn pit-add" autoFocus onClick={onClose}>Cancel</button>
            <button type="button" className="btn btn-primary pit-add" disabled={saving}
              onClick={() => void save(removePitItem(item.id), 'Checklist item removed.')}>Remove</button>
          </div>
        </>}
        {mode === 'people' && <ItemPeople item={item} onSaved={onSaved} onError={setError} onClose={onClose} />}
        {error && <p id="pit-popup-error" role="alert">{error}</p>}
      </div>
    </dialog>
  )
}

/**
 * The People popup for one item: who's on it, and adding or taking off
 * people with one tap each. Changes save straight away and never uncheck
 * the item. It lists the item's subgroup; where that's the whole team
 * (General, or a subgroup not set up on this device), the people already on
 * other items until a name is typed (suggestedFor()).
 */
function ItemPeople(props: { item: PitItem; onSaved: (message: string) => void; onError: (error: string) => void; onClose: () => void }) {
  const { item } = props
  const members = useMembers()
  const items = usePitChecklist()
  const [saving, setSaving] = useState(false)
  const pool = members.filter((member) => member.active && belongsToSubgroup(member.id, item.subgroup))

  async function save(ids: string[], message: string) {
    setSaving(true)
    const result = await assignPitItem(item.id, ids)
    setSaving(false)
    props.onError(result.ok ? '' : result.error)
    if (result.ok) props.onSaved(message)
  }
  const nameOf = (id: string) => members.find((member) => member.id === id)?.name ?? 'Former member'

  return (
    <>
      <p className="note" style={{ margin: 0 }}>
        {item.text} · {item.subgroup === 'General' ? 'Anyone on the team' : `${item.subgroup} members`}. Changes save straight away.
      </p>
      <PeoplePicker findId="pit-people-find" disabled={saving}
        chosen={item.assignee_ids.map((id) => ({ id, name: nameOf(id) }))}
        pool={pool}
        suggestedIds={suggestedFor([item.subgroup], items)}
        nobody={`Nobody is in ${item.subgroup} yet. Add people to it in the Subgroups panel under the checklist.`}
        onAdd={(id) => void save([...item.assignee_ids, id], `${nameOf(id)} added to ${item.text}.`)}
        onRemove={(id) => void save(item.assignee_ids.filter((old) => old !== id), `${nameOf(id)} taken off ${item.text}.`)} />
      <div className="toolbar">
        <button type="button" className="btn btn-primary pit-add" onClick={props.onClose}>Done</button>
      </div>
    </>
  )
}
