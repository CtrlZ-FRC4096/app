import { useEffect, useRef, useState } from 'react'
import { MAX_ITEM_LENGTH, PIT_SUBGROUPS, renamePitItem, setPitItemSubgroup, type PitItem } from './data'

export type ItemPopupMode = 'subgroup' | 'rename'

export function ItemPopup({ item, mode, onClose, onSaved }: {
  item: PitItem
  mode: ItemPopupMode
  onClose: () => void
  onSaved: (message: string) => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [text, setText] = useState(item.text)
  const [error, setError] = useState('')

  useEffect(() => {
    const element = dialog.current!
    element.showModal()
    element.querySelector<HTMLElement>('#pit-popup-name, [aria-pressed="true"]')?.focus()
    return () => element.close()
  }, [])

  return (
    <dialog ref={dialog} className="pit-popup" aria-labelledby="pit-popup-title" onCancel={onClose}
      onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className="pit-popup-body">
        <div className="pit-popup-head">
          <h2 id="pit-popup-title">{mode === 'rename' ? 'Rename item' : 'Choose subgroup'}</h2>
          <button className="btn pit-add" type="button" aria-label="Close popup" onClick={onClose}>×</button>
        </div>
        {mode === 'subgroup' ? <>
          <p className="note">{item.text} · Select a subgroup to save immediately.</p>
          <div className="pit-subgroup-options">
            {PIT_SUBGROUPS.map((group) => <button key={group} type="button" className="btn pit-subgroup-option"
              autoFocus={group === (item.subgroup ?? 'General')} aria-pressed={group === (item.subgroup ?? 'General')}
              onClick={() => {
                const result = setPitItemSubgroup(item.id, group)
                if (!result.ok) { setError(result.error); return }
                onSaved('Subgroup saved.')
                onClose()
              }}>
              <span className="pit-subgroup-tag" data-subgroup={group}>{group}</span>
              {group === (item.subgroup ?? 'General') && <span aria-hidden="true">✓</span>}
            </button>)}
          </div>
        </> : <form className="stack" onSubmit={(event) => {
          event.preventDefault()
          const result = renamePitItem(item.id, text)
          if (!result.ok) { setError(result.error); return }
          onSaved('Checklist item renamed.')
          onClose()
        }}>
          <label className="field" htmlFor="pit-popup-name">
            Item name
            <input autoFocus id="pit-popup-name" className="input" maxLength={MAX_ITEM_LENGTH} value={text}
              onChange={(event) => { setText(event.target.value); setError('') }} aria-invalid={!!error}
              aria-describedby={error ? 'pit-popup-error' : undefined} />
          </label>
          <div className="toolbar">
            <button type="button" className="btn pit-add" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary pit-add">Rename</button>
          </div>
        </form>}
        {error && <p id="pit-popup-error" role="alert">{error}</p>}
      </div>
    </dialog>
  )
}
