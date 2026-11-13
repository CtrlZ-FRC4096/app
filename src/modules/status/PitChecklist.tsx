import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { Bar, Panel, Pill } from '../../core/ui'
import { MAX_ITEM_LENGTH, PIT_SUBGROUPS, type PitSubgroup, addPitItem, assignPitItem, movePitItem, movePitItemTo, setPitItemCompleted, usePitChecklist, useSubgroupMembers, belongsToSubgroup, setSubgroupMembers } from './data'
import { useMembers } from '../../core/members'
import { isMentor, useSession } from '../../core/session'
import { usePitDrag } from './usePitDrag'
import { ItemPopup, type ItemPopupMode } from './ItemPopup'
import { MemberPicker } from './MemberPicker'

/** The pit checklist section of the Robot status page. */
export function PitChecklist() {
  const items = usePitChecklist()
  const user = useSession()
  const members = useMembers()
  const activeMembers = members.filter((member) => member.active)
  const subgroupMembers = useSubgroupMembers()
  const membersFor = (group: PitSubgroup) => activeMembers.filter((member) => group === 'General' || subgroupMembers[group]?.includes(member.id))
  const [assigneeIds, setAssigneeIds] = useState<string[]>([user.id])
  const [text, setText] = useState('')
  const [subgroup, setSubgroup] = useState<PitSubgroup>('General')
  const [error, setError] = useState('')
  const [popup, setPopup] = useState<{ id: string; mode: ItemPopupMode } | null>(null)
  const popupItem = items.find((item) => item.id === popup?.id)
  const input = useRef<HTMLInputElement>(null)
  const completed = items.filter((item) => item.completed).length
  const [announcement, setAnnouncement] = useState('')
  // The item just moved with Move to…, to light up and scroll to.
  const [moved, setMoved] = useState<{ id: string; n: number } | null>(null)
  const list = useRef<HTMLUListElement>(null)
  const drag = usePitDrag((error, announcement) => {
    setError(error)
    setAnnouncement(announcement)
  })

  // Scroll a moved item into view, and stop lighting it up after a moment.
  useEffect(() => {
    if (!moved) return
    const row = [...(list.current?.querySelectorAll<HTMLElement>('[data-pit-id]') ?? [])].find((r) => r.dataset.pitId === moved.id)
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    row?.scrollIntoView({ block: 'nearest', behavior: still ? 'auto' : 'smooth' })
    const stop = setTimeout(() => setMoved((now) => (now === moved ? null : now)), 1200)
    return () => clearTimeout(stop)
  }, [moved])

  /** Move to… in an item's menu. Gives back what went wrong, for the menu to show, or '' if it moved. */
  function moveTo(id: string, place: string, name: string): string {
    const result = movePitItemTo(id, place)
    if (!result.ok) return result.error
    setError('')
    setMoved((last) => ({ id, n: (last?.n ?? 0) + 1 }))
    setAnnouncement(`Moved ${name} to position ${Number(place)}.`)
    return ''
  }

  function add(event: FormEvent) {
    event.preventDefault()
    const result = addPitItem(text, assigneeIds, subgroup)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setText('')
    setError('')
    input.current?.focus()
  }

  return (
    <section className="stack" aria-labelledby="pit-checklist-title">
      <h2 id="pit-checklist-title">Pit checklist</h2>
      <p className="muted">
        Drag the handle on the right to reorder items, or use Move to… in an item's three-dot menu. Only assigned people can check or uncheck an item. Mentors can also change assignments and rename items there.
      </p>
      <div className="callout">
        <strong>Local preview</strong>
        <p>Changes are saved in this browser when storage is available. This checklist is not shared with the team. Assignment checks are a local preview; shared access rules still need database support. Reset example data restores the starter items.</p>
      </div>
      <Panel title="Checklist" aside={<Pill tone={items.length > 0 && completed === items.length ? 'ok' : 'plain'}>{completed} of {items.length} done</Pill>}>
        <div className="panel-body">
          <p className="muted" role="status">
            {items.length === 0 ? 'No items yet. Add the first one below.' : completed === items.length ? 'All checked off.' : `${items.length - completed} left to check.`}
          </p>
          <Bar value={items.length ? completed / items.length : 0} label="Pit checklist completion" />
        </div>
        <p className="pit-sr-only" role="status">{announcement}</p>
        <ul ref={list} className="pit-checklist">
          {items.map((item) => (
            <li key={item.id} data-pit-id={item.id} className={drag.activeId === item.id ? 'pit-dragging' : !drag.activeId && moved?.id === item.id ? 'pit-moved' : undefined} style={drag.style(item.id)}>
              <div className="pit-item-heading">
              <label className="check pit-item">
                <input type="checkbox" aria-label={item.text} checked={item.completed} disabled={!item.assigneeIds?.includes(user.id) || !belongsToSubgroup(user.id, item.subgroup ?? 'General')} onChange={(event) => {
                  const result = setPitItemCompleted(item.id, event.target.checked)
                  setError(result.ok ? '' : result.error)
                }} />
                <span className={item.completed ? 'pit-item-done' : undefined}>{item.text}</span>
              </label>
              <button type="button" className="pit-subgroup-tag" data-subgroup={item.subgroup ?? 'General'}
                aria-label={`Change subgroup for ${item.text}: ${item.subgroup ?? 'General'}`}
                disabled={!isMentor(user.role)} title={isMentor(user.role) ? 'Change subgroup' : 'Ask a mentor to change the subgroup'}
                onClick={(event) => {
                  event.currentTarget.closest('li')?.querySelector('.pit-menu')?.removeAttribute('open')
                  setPopup({ id: item.id, mode: 'subgroup' })
                }}>{item.subgroup ?? 'General'}</button>
              </div>
              <div className="pit-item-tools">
                <p className="note">Assigned to: {item.assigneeIds?.length ? item.assigneeIds.map((id) => members.find((member) => member.id === id)?.name ?? 'Former member').join(', ') : 'Unassigned — ask a mentor to assign people'}</p>
              </div>
                  <details className="pit-menu" onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      event.currentTarget.open = false
                      event.currentTarget.querySelector('summary')?.focus()
                    }
                  }}>
                    <summary aria-label={`More options for ${item.text}`} title="More options">⋯</summary>
                    <div className="pit-menu-content">
                    <PitMoveTo name={item.text} place={items.indexOf(item) + 1} count={items.length} group={`pit-tools-${item.id}`}
                      onMove={(place) => moveTo(item.id, place, item.text)} />
                    {isMentor(user.role) && <>
                    <details className="pit-submenu" name={`pit-tools-${item.id}`}>
                    <summary>Person assignment</summary>
                    <div className="pit-assign">
                      <strong>Assign people</strong>
                      <p className="note">Selections save automatically and mark this item incomplete. Clear all to leave it unassigned.</p>
                      <p className="note">Showing {item.subgroup ?? 'General'} members only.</p>
                      {membersFor(item.subgroup ?? 'General').length === 0 && <p className="note">No active members in this subgroup. Edit subgroup members below.</p>}
                      <MemberPicker members={membersFor(item.subgroup ?? 'General')} chosenIds={item.assigneeIds ?? []} onChange={(memberId, chosen) => {
                        const ids = chosen ? [...(item.assigneeIds ?? []), memberId] : (item.assigneeIds ?? []).filter((id) => id !== memberId)
                        const result = assignPitItem(item.id, ids)
                        setError(result.ok ? '' : result.error)
                        if (result.ok) setAnnouncement('Assignment saved.')
                      }} />
                    </div>
                    {(item.subgroup ?? 'General') !== 'General' && <details className="pit-members-editor">
                      <summary>Edit subgroup members</summary>
                      <div className="pit-assign">
                        <p className="note">Applies to all {item.subgroup} items in this browser. Removing people also removes their assignments.</p>
                        <MemberPicker members={activeMembers} chosenIds={subgroupMembers[item.subgroup!] ?? []} onChange={(memberId, chosen) => {
                          const ids = subgroupMembers[item.subgroup!] ?? []
                          const result = setSubgroupMembers(item.subgroup!, chosen ? [...ids, memberId] : ids.filter((id) => id !== memberId))
                          setError(result.ok ? '' : result.error)
                          if (result.ok) setAnnouncement('Subgroup members saved.')
                        }} />
                      </div>
                    </details>}
                    </details>
                    <button type="button" className="pit-menu-action" onClick={(event) => {
                      const menu = event.currentTarget.closest('.pit-menu')
                      menu?.removeAttribute('open')
                      menu?.querySelector('summary')?.focus()
                      setPopup({ id: item.id, mode: 'rename' })
                    }}>Rename</button>
                    <div className="pit-future-tools">
                      <span>Other tools</span>
                      <p className="note">More tools can be added here.</p>
                    </div>
                    </>}
                    </div>
                  </details>
              <button type="button" className="pit-drag-handle" aria-label={`Reorder ${item.text}`}
                title="Drag to reorder. Use Up and Down arrow keys when focused."
                onPointerDown={(event) => drag.start(event, item.id)}
                onPointerMove={drag.move}
                onPointerUp={(event) => { drag.move(event); drag.finish() }}
                onPointerCancel={() => drag.finish(true)} onLostPointerCapture={() => drag.finish(true)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') drag.finish(true)
                  if (drag.activeId) return
                  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
                  event.preventDefault()
                  const direction = event.key === 'ArrowUp' ? -1 : 1
                  const result = movePitItem(item.id, direction)
                  setError(result.ok ? '' : result.error)
                  const position = Math.max(1, Math.min(items.length, items.findIndex((row) => row.id === item.id) + 1 + direction))
                  if (result.ok) setAnnouncement(`Moved ${item.text} to position ${position}.`)
                }}><span aria-hidden="true">⠿</span></button>
            </li>
          ))}
        </ul>
      </Panel>
      {popup && popupItem && <ItemPopup key={`${popup.id}:${popup.mode}`} item={popupItem} mode={popup.mode}
        onClose={() => setPopup(null)} onSaved={(message) => { setError(''); setAnnouncement(message) }} />}
      {error && <p id="pit-item-error" role="alert">{error}</p>}
      <Panel title="Add an item">
        <form className="panel-body" onSubmit={add}>
          <label className="field" htmlFor="pit-item-text">
            Checklist item
            <input ref={input} id="pit-item-text" className="input" value={text} maxLength={MAX_ITEM_LENGTH}
              onChange={(event) => { setText(event.target.value); setError('') }}
              placeholder="For example: Check tire wear" aria-invalid={!!error}
              aria-describedby={error ? 'pit-item-error' : undefined} />
          </label>
          <label className="field" htmlFor="new-pit-subgroup">
            Team subgroup
            <select id="new-pit-subgroup" className="input" value={subgroup} onChange={(event) => {
              const group = event.target.value as PitSubgroup
              setSubgroup(group)
              setAssigneeIds((ids) => ids.filter((id) => belongsToSubgroup(id, group)))
            }}>
              {PIT_SUBGROUPS.map((group) => <option key={group}>{group}</option>)}
            </select>
          </label>
          <fieldset className="pit-assign">
            <legend>Assign people (choose at least one)</legend>
            {membersFor(subgroup).length === 0 && <p className="note">No active members in this subgroup. Ask a mentor to edit subgroup members.</p>}
            <MemberPicker members={membersFor(subgroup)} chosenIds={assigneeIds} onChange={(memberId, chosen) => {
              setAssigneeIds(chosen ? [...assigneeIds, memberId] : assigneeIds.filter((id) => id !== memberId))
            }} />
          </fieldset>
          <div className="toolbar">
            <button type="submit" className="btn btn-primary pit-add">Add item</button>
          </div>
        </form>
      </Panel>
    </section>
  )
}

// "Move to…" in an item's three-dot menu, for everyone: anyone can reorder
// the checklist. A dropdown with a box for the position and a Move button.
// A wrong position is explained right under the box, so it's seen while the
// menu is open. `group` makes it close when another dropdown in the same
// menu opens.
function PitMoveTo(props: { name: string; place: number; count: number; group: string; onMove: (place: string) => string }) {
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const id = useId()
  return (
    <details className="pit-submenu" name={props.group} onToggle={(event) => { if (event.currentTarget.open) input.current?.focus() }}>
      <summary>Move to…</summary>
      <form className="pit-move-to" onSubmit={(event) => {
        event.preventDefault()
        const problem = Number(text) === props.place ? `It's already at position ${props.place}.` : props.onMove(text)
        setError(problem)
        if (problem) {
          input.current?.focus()
          return
        }
        setText('')
        const menu = event.currentTarget.closest('.pit-menu')
        menu?.removeAttribute('open')
        menu?.querySelector('summary')?.focus()
      }}>
        <label htmlFor={id}>{`Position, from 1 to ${props.count}. It's at ${props.place} now.`}</label>
        <div className="pit-move-to-row">
          <input ref={input} id={id} className="input" inputMode="numeric" enterKeyHint="go" autoComplete="off" placeholder="#"
            value={text} aria-invalid={!!error} aria-describedby={error ? `${id}-error` : undefined}
            onChange={(event) => { setText(event.target.value.replace(/\D/g, '')); setError('') }} />
          <button type="submit" className="btn btn-primary" disabled={!text}>Move</button>
        </div>
        {error && <p id={`${id}-error`} className="note" role="alert" style={{ margin: 0 }}>{error}</p>}
      </form>
    </details>
  )
}
