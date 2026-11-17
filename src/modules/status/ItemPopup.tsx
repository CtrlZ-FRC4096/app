import { useEffect, useRef, useState } from 'react'
import { MAX_ITEM_LENGTH, PIT_SUBGROUPS, removePitItem, renamePitItem, setPitItemSubgroup, type PitItem } from './data'

export type ItemPopupMode = 'subgroup' | 'rename' | 'delete'

const TITLES: Record<ItemPopupMode, string> = { subgroup: 'Choose subgroup', rename: 'Rename item', delete: 'Delete item' }

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
    element.querySelector<HTMLElement>('#pit-popup-name, [aria-pressed="true"]')?.focus()
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
        {mode === 'delete' && <>
          <p>Delete “{item.text}”? It comes off the checklist for everyone, with its checks for every match. This can't be undone.</p>
          <div className="toolbar">
            <button type="button" className="btn pit-add" autoFocus onClick={onClose}>Cancel</button>
            <button type="button" className="btn btn-primary pit-add" disabled={saving}
              onClick={() => void save(removePitItem(item.id), 'Checklist item deleted.')}>Delete</button>
          </div>
        </>}
        {error && <p id="pit-popup-error" role="alert">{error}</p>}
      </div>
    </dialog>
  )
}
