import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode, type SyntheticEvent } from 'react'
import { checkPlace } from './data'
import './lists.css'

// The three-dot menu on a row of a picklist. It closes when you tap outside
// it, press Escape, or pick something. What's in it is only drawn while it's
// open, so a long list stays quick.
export function RowMenu(props: { label: string; children: (close: () => void) => ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null)
  const [open, setOpen] = useState(false)
  const close = () => setOpen(false)

  // Close on a tap anywhere else. Returns a cleanup on purpose.
  useEffect(() => {
    if (!open) return
    function away(event: globalThis.PointerEvent) {
      if (!ref.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [open])

  function toggled(event: SyntheticEvent<HTMLDetailsElement>) {
    const menu = event.currentTarget
    setOpen(menu.open)
    // Closed from inside the menu (Escape, or picking something): put the
    // focus back on the ⋯ button, so a keyboard user isn't lost.
    if (!menu.open && (document.activeElement === document.body || menu.contains(document.activeElement))) {
      menu.querySelector('summary')?.focus()
    }
  }

  return (
    <details ref={ref} className="row-menu" open={open} onToggle={toggled}
      onKeyDown={(event) => { if (event.key === 'Escape' && open) { event.stopPropagation(); setOpen(false) } }}>
      <summary aria-label={props.label} title="More options"><span aria-hidden="true">⋯</span></summary>
      {open && <div className="row-menu-panel">{props.children(close)}</div>}
    </details>
  )
}

/** A plain button in a RowMenu, like Move to top. */
export function MenuAction(props: { disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" className="row-menu-action" disabled={props.disabled} onClick={props.onClick}>{props.children}</button>
}

// A red button at the bottom of a RowMenu for something that can't be
// undone, like Remove. The first tap asks, right in the menu, with a button
// to do it and Cancel, so one slip of a finger doesn't remove anything.
export function ConfirmAction(props: { label: string; question: string; confirm: string; disabled?: boolean; onConfirm: () => void }) {
  const [asking, setAsking] = useState(false)
  const id = useId()
  return (
    <div className="row-menu-end">
      {asking ? (
        <div className="row-menu-confirm" role="group" aria-labelledby={id}>
          <p id={id}>{props.question}</p>
          <div className="move-to-row">
            <button type="button" className="btn btn-remove" disabled={props.disabled} onClick={props.onConfirm}>{props.confirm}</button>
            {/* Focus lands on Cancel, so pressing Enter by habit doesn't remove anything. */}
            <button type="button" className="btn" autoFocus onClick={() => setAsking(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <button type="button" className="row-menu-action row-menu-danger" disabled={props.disabled} onClick={() => setAsking(true)}>{props.label}</button>
      )}
    </div>
  )
}

// "Move to…": a dropdown in the menu with a box to type the place and a
// Move button. checkPlace() in data.ts says whether the place is one.
export function MoveTo(props: { name: string; place: number; count: number; disabled?: boolean; onMove: (place: number) => void }) {
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const id = useId()

  function submit(event: FormEvent) {
    event.preventDefault()
    const result = checkPlace(text, props.count)
    if (!result.ok) {
      setError(result.error)
      input.current?.focus()
      return
    }
    if (result.value === props.place) {
      setError(`${props.name} is already at place ${props.place}.`)
      return
    }
    props.onMove(result.value)
  }

  return (
    <details className="row-submenu" onToggle={(event) => { if (event.currentTarget.open) input.current?.focus() }}>
      <summary>Move to…</summary>
      <form className="move-to" onSubmit={submit}>
        <label htmlFor={id}>{`Place, from 1 to ${props.count}. It's at ${props.place} now.`}</label>
        <div className="move-to-row">
          <input ref={input} id={id} className="input" inputMode="numeric" enterKeyHint="go" autoComplete="off" placeholder="#"
            value={text} aria-invalid={!!error} aria-describedby={error ? `${id}-error` : undefined}
            onChange={(event) => { setText(event.target.value.replace(/\D/g, '')); setError('') }} />
          <button type="submit" className="btn btn-primary" disabled={props.disabled || !text}>Move</button>
        </div>
        {error && <p id={`${id}-error`} className="note" role="alert" style={{ margin: 0 }}>{error}</p>}
      </form>
    </details>
  )
}
