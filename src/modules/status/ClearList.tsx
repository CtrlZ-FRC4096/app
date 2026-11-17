import { useEffect, useRef, useState } from 'react'
import { plural } from '../../core/format'
import { clearPitChecklist, uncheckAllPitItems, type PitMatch } from './data'

type Choice = 'uncheck' | 'remove'

/**
 * The Clear list button under the checklist, for student leaders, mentors
 * and admins. It opens a small popup with two choices: uncheck everything
 * for the chosen match (the items and their people stay), or remove every
 * item. Each says how many items it affects and needs a second tap.
 */
export function ClearList(props: { match: PitMatch; itemCount: number; checkedCount: number; onDone: (message: string) => void }) {
  const [open, setOpen] = useState(false)
  if (props.itemCount === 0) return null
  return (
    <div className="toolbar">
      <button type="button" className="btn pit-add" onClick={() => setOpen(true)}>Clear list</button>
      {open && <ClearPopup {...props} onClose={() => setOpen(false)} />}
    </div>
  )
}

function ClearPopup(props: { match: PitMatch; itemCount: number; checkedCount: number; onDone: (message: string) => void; onClose: () => void }) {
  const { match, itemCount, checkedCount, onClose } = props
  const dialog = useRef<HTMLDialogElement>(null)
  // The choice waiting for its second tap, if one has been picked.
  const [choice, setChoice] = useState<Choice | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const element = dialog.current!
    element.showModal()
    return () => element.close()
  }, [])

  async function confirm() {
    setSaving(true)
    const result = choice === 'uncheck' ? await uncheckAllPitItems(match.key) : await clearPitChecklist()
    setSaving(false)
    if (!result.ok) { setError(result.error); return }
    props.onDone(choice === 'uncheck' ? `Unchecked ${plural(result.value, 'item', 'items')} for ${match.label}.` : `Removed ${plural(result.value, 'item', 'items')}.`)
    onClose()
  }

  return (
    <dialog ref={dialog} className="pit-popup" aria-labelledby="pit-clear-title" onCancel={onClose}
      onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className="pit-popup-body">
        <div className="pit-popup-head">
          <h2 id="pit-clear-title">Clear list</h2>
          <button className="btn pit-add" type="button" aria-label="Close popup" onClick={onClose}>×</button>
        </div>
        {choice === null && <>
          <div className="stack">
            <button type="button" className="btn pit-add" disabled={checkedCount === 0} onClick={() => setChoice('uncheck')}>Uncheck everything</button>
            <p className="note" style={{ margin: 0 }}>
              {checkedCount === 0
                ? `Nothing is checked for ${match.label}.`
                : `Unchecks the ${plural(checkedCount, 'item', 'items')} checked for ${match.label}. The items and their people stay. Other matches keep their checks.`}
            </p>
          </div>
          <div className="stack">
            <button type="button" className="btn pit-add" onClick={() => setChoice('remove')}>Remove every item</button>
            <p className="note" style={{ margin: 0 }}>Empties the list for everyone: all {plural(itemCount, 'item', 'items')}, with their checks for every match.</p>
          </div>
        </>}
        {choice !== null && <>
          <p style={{ margin: 0 }}>
            {choice === 'uncheck'
              ? `Uncheck ${checkedCount === 1 ? 'the 1 checked item' : `all ${checkedCount} checked items`} for ${match.label}?`
              : `Remove ${itemCount === 1 ? 'the 1 item' : `all ${itemCount} items`}? They come off the checklist for everyone, with their checks for every match. This can't be undone.`}
          </p>
          <div className="toolbar">
            <button type="button" className="btn pit-add" autoFocus onClick={() => { setChoice(null); setError('') }}>Cancel</button>
            <button type="button" className="btn btn-primary pit-add" disabled={saving} onClick={() => void confirm()}>
              {choice === 'uncheck' ? 'Uncheck everything' : 'Remove every item'}
            </button>
          </div>
        </>}
        {error && <p role="alert" style={{ margin: 0 }}>{error}</p>}
      </div>
    </dialog>
  )
}
