import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { plural } from '../../core/format'
import { Bar, Panel, PeoplePicker, Pill } from '../../core/ui'
import {
  MAX_ITEM_LENGTH, PIT_SUBGROUPS, type PitItem, type PitMatch, type PitSubgroup, addPitItem, belongsToSubgroup, canCheck, checkedIds, matchProgress,
  movePitItem, movePitItemTo, progressText, setPitItemCompleted, suggestedFor, takenOffText, usePitChecklist, usePitChecks, useSubgroupMembers,
} from './data'
import { useMembers } from '../../core/members'
import { useSession } from '../../core/session'
import { usePitDrag } from './usePitDrag'
import { AssignPeople } from './AssignPeople'
import { ClearList } from './ClearList'
import { ItemPopup, type ItemPopupMode } from './ItemPopup'
import { SubgroupsPanel } from './SubgroupsPanel'

/** The full pit checklist, for student leaders, mentors and admins: every item, checked for the chosen match. */
export function PitChecklist({ match }: { match: PitMatch }) {
  const items = usePitChecklist()
  const checked = checkedIds(usePitChecks(), match.key)
  const progress = matchProgress(items, usePitChecks(), match.key)
  const user = useSession()
  const members = useMembers()
  const activeMembers = members.filter((member) => member.active)
  // Read so the lists of who can be chosen update when a subgroup's members change.
  useSubgroupMembers()
  const nameOf = (id: string) => members.find((member) => member.id === id)?.name ?? 'Former member'
  const membersFor = (group: string) => activeMembers.filter((member) => belongsToSubgroup(member.id, group))
  const [assigneeIds, setAssigneeIds] = useState<string[]>([])
  const [text, setText] = useState('')
  const [subgroup, setSubgroup] = useState<PitSubgroup>('General')
  const [error, setError] = useState('')
  // Who was taken off the new item when its subgroup changed, to say so.
  const [takenOff, setTakenOff] = useState('')
  const [popup, setPopup] = useState<{ id: string; mode: ItemPopupMode } | null>(null)
  const popupItem = items.find((item) => item.id === popup?.id)
  const input = useRef<HTMLInputElement>(null)
  const [announcement, setAnnouncement] = useState('')
  // The item just moved with Move to…, to light up and scroll to.
  const [moved, setMoved] = useState<{ id: string; n: number } | null>(null)
  const list = useRef<HTMLUListElement>(null)
  const drag = usePitDrag((error, announcement) => {
    setError(error)
    setAnnouncement(announcement)
  })
  // Select mode: tick several items, then Assign people gives them all the same people.
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  // The items in the Assign people popup while it's open, or none.
  const [assigningIds, setAssigningIds] = useState<string[]>([])
  // What the last Assign people did, shown while the items it skipped are still ticked.
  const [notice, setNotice] = useState('')
  // Worked out from the list each time, so items someone else removes drop
  // out. If every item in the popup goes, the popup closes.
  const ticked = items.filter((item) => selected.includes(item.id))
  const assigning = items.filter((item) => assigningIds.includes(item.id))

  // Scroll a moved item into view, and stop lighting it up after a moment.
  useEffect(() => {
    if (!moved) return
    const row = [...(list.current?.querySelectorAll<HTMLElement>('[data-pit-id]') ?? [])].find((r) => r.dataset.pitId === moved.id)
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    row?.scrollIntoView({ block: 'nearest', behavior: still ? 'auto' : 'smooth' })
    const stop = setTimeout(() => setMoved((now) => (now === moved ? null : now)), 1200)
    return () => clearTimeout(stop)
  }, [moved])

  /** Show what a change says went wrong, or announce it worked. */
  async function run(change: Promise<{ ok: true } | { ok: false; error: string }>, done = '') {
    const result = await change
    setError(result.ok ? '' : result.error)
    if (result.ok && done) setAnnouncement(done)
    return result.ok
  }

  /** Move to… in an item's menu. Gives back what went wrong, for the menu to show, or '' if it moved. */
  async function moveTo(id: string, place: string, name: string): Promise<string> {
    const result = await movePitItemTo(id, place)
    if (!result.ok) return result.error
    setError('')
    setMoved((last) => ({ id, n: (last?.n ?? 0) + 1 }))
    setAnnouncement(`Moved ${name} to position ${Number(place)}.`)
    return ''
  }

  /** Select, or Cancel: start or stop ticking items, with nothing ticked. */
  function switchSelecting() {
    setSelecting(!selecting)
    setSelected([])
    setNotice('')
  }

  function tick(id: string) {
    setSelected((ids) => (ids.includes(id) ? ids.filter((other) => other !== id) : [...ids, id]))
    setNotice('')
  }

  /** After Assign people. Items it skipped stay ticked, so they can go to someone else; with none, select mode ends. */
  function assigned(message: string, skippedIds: string[]) {
    const text = skippedIds.length ? `${message} ${plural(skippedIds.length, 'skipped item is', 'skipped items are')} still ticked.` : message
    setError('')
    setAnnouncement(text)
    setNotice(skippedIds.length ? text : '')
    setSelected(skippedIds)
    setSelecting(skippedIds.length > 0)
  }

  async function add(event: FormEvent) {
    event.preventDefault()
    if (!(await run(addPitItem(text, assigneeIds, subgroup), 'Item added.'))) return
    setText('')
    setAssigneeIds([])
    setTakenOff('')
    input.current?.focus()
  }

  return (
    <section className="stack" aria-labelledby="pit-checklist-title">
      <h2 id="pit-checklist-title">Full checklist</h2>
      <p className="muted">
        Checks are for {match.label}. Drag the handle on the right to reorder items, or use Move to… in an item's three-dot menu. Rename and remove items there too. Tap an item's people to change who's on it, and its subgroup tag to change the subgroup. To give several items to the same people, tap Select above the list, tick them, then tap Assign people. Clear list, under the checklist, unchecks everything for this match or removes every item.
      </p>
      <Panel title="Checklist" aside={<Pill tone={progress.ready ? 'ok' : 'plain'}>{progressText(progress)}</Pill>}>
        <div className="panel-body">
          <p className="muted" role="status">
            {items.length === 0 ? 'No items yet. Add the first one below.' : progress.ready ? `All checked off for ${match.label}.` : `${progress.left} left to check for ${match.label}.`}
          </p>
          <Bar value={items.length ? progress.done / items.length : 0} label={`Pit checklist for ${match.label}`} />
          {items.length > 0 && (
            <div className="toolbar">
              <button type="button" className="btn pit-add" onClick={switchSelecting}>{selecting ? 'Cancel' : 'Select'}</button>
              {selecting && <button type="button" className="btn btn-primary pit-add" disabled={!ticked.length}
                onClick={() => setAssigningIds(ticked.map((item) => item.id))}>Assign people</button>}
            </div>
          )}
          {selecting && items.length > 0 && <p className="note pit-notice">{notice || (ticked.length ? `${plural(ticked.length, 'item', 'items')} ticked.` : 'Tick the items to give to the same people, then tap Assign people.')}</p>}
        </div>
        <p className="pit-sr-only" role="status">{announcement}</p>
        <ul ref={list} className={selecting ? 'pit-checklist pit-selecting' : 'pit-checklist'}>
          {items.map((item) => selecting ? (
            <PitSelectRow key={item.id} item={item} nameOf={nameOf} ticked={selected.includes(item.id)} onTick={() => tick(item.id)} />
          ) : (
            <li key={item.id} data-pit-id={item.id} className={drag.activeId === item.id ? 'pit-dragging' : !drag.activeId && moved?.id === item.id ? 'pit-moved' : undefined} style={drag.style(item.id)}>
              <div className="pit-item-heading">
              <label className="check pit-item">
                <input type="checkbox" aria-label={item.text} checked={checked.has(item.id)} disabled={!canCheck(item, user)} onChange={(event) => {
                  void run(setPitItemCompleted(item.id, match.key, event.target.checked))
                }} />
                <span className={checked.has(item.id) ? 'pit-item-done' : undefined}>{item.text}</span>
              </label>
              <button type="button" className="pit-subgroup-tag" data-subgroup={item.subgroup}
                aria-label={`Change subgroup for ${item.text}: ${item.subgroup}`} title="Change subgroup"
                onClick={(event) => {
                  event.currentTarget.closest('li')?.querySelector('.pit-menu')?.removeAttribute('open')
                  setPopup({ id: item.id, mode: 'subgroup' })
                }}>{item.subgroup}</button>
              </div>
              <div className="pit-item-tools">
                <button type="button" className="pit-people"
                  aria-label={item.assignee_ids.length ? `Change people for ${item.text}: ${item.assignee_ids.map(nameOf).join(', ')}` : `Add people to ${item.text}`}
                  onClick={(event) => {
                    event.currentTarget.closest('li')?.querySelector('.pit-menu')?.removeAttribute('open')
                    setPopup({ id: item.id, mode: 'people' })
                  }}>
                  {item.assignee_ids.map((id) => <span key={id} className="person-chip">{nameOf(id)}</span>)}
                  {item.assignee_ids.length === 0 && <span className="person-chip pit-chip-add">+ Add people</span>}
                </button>
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
                    {(['rename', 'remove'] as const).map((mode) => (
                      <button key={mode} type="button" className="pit-menu-action" onClick={(event) => {
                        const menu = event.currentTarget.closest('.pit-menu')
                        menu?.removeAttribute('open')
                        menu?.querySelector('summary')?.focus()
                        setPopup({ id: item.id, mode })
                      }}>{mode === 'rename' ? 'Rename' : 'Remove'}</button>
                    ))}
                    <div className="pit-future-tools">
                      <span>Other tools</span>
                      <p className="note">More tools can be added here.</p>
                    </div>
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
                  const position = Math.max(1, Math.min(items.length, items.findIndex((row) => row.id === item.id) + 1 + direction))
                  void run(movePitItem(item.id, direction), `Moved ${item.text} to position ${position}.`)
                }}><span aria-hidden="true">⠿</span></button>
            </li>
          ))}
        </ul>
      </Panel>
      {/* Clear list starts over, so it ends select mode too. */}
      <ClearList match={match} itemCount={items.length} checkedCount={progress.done} onDone={(message) => { setError(''); setAnnouncement(message); setSelecting(false) }} />
      {popup && popupItem && <ItemPopup key={`${popup.id}:${popup.mode}`} item={popupItem} mode={popup.mode}
        onClose={() => setPopup(null)} onSaved={(message) => { setError(''); setAnnouncement(message) }} />}
      {assigning.length > 0 && <AssignPeople items={assigning} onClose={() => setAssigningIds([])} onSaved={assigned} />}
      {error && <p id="pit-item-error" role="alert">{error}</p>}
      <Panel title="Add an item">
        <form className="panel-body" onSubmit={(event) => void add(event)}>
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
              // Say who comes off, rather than taking them off without a word.
              setTakenOff(takenOffText(assigneeIds, group, members, user.id))
              setAssigneeIds((ids) => ids.filter((id) => belongsToSubgroup(id, group)))
            }}>
              {PIT_SUBGROUPS.map((group) => <option key={group}>{group}</option>)}
            </select>
          </label>
          {takenOff && <p className="note" role="status" style={{ margin: 0 }}>{takenOff}</p>}
          <fieldset className="pit-assign">
            <legend>People (choose at least one)</legend>
            <PeoplePicker findId="new-pit-people-find"
              chosen={assigneeIds.map((id) => ({ id, name: nameOf(id) }))}
              pool={membersFor(subgroup)}
              suggestedIds={suggestedFor([subgroup], items)}
              nobody={`Nobody is in ${subgroup} yet. Add people to it in the Subgroups panel below.`}
              onAdd={(id) => { setAssigneeIds([...assigneeIds, id]); setTakenOff('') }}
              onRemove={(id) => setAssigneeIds(assigneeIds.filter((old) => old !== id))} />
          </fieldset>
          <div className="toolbar">
            <button type="submit" className="btn btn-primary pit-add">Add item</button>
          </div>
        </form>
      </Panel>
      <SubgroupsPanel onSaved={(message) => { setError(''); setAnnouncement(message) }} />
    </section>
  )
}

// An item in select mode: a tick box to choose it for Assign people. Its
// subgroup and people show, but aren't buttons, and there's no three-dot
// menu or drag handle while selecting.
function PitSelectRow(props: { item: PitItem; nameOf: (id: string) => string; ticked: boolean; onTick: () => void }) {
  const { item } = props
  return (
    <li className={props.ticked ? 'pit-selected' : undefined}>
      <div className="pit-item-heading">
        <label className="check pit-item">
          <input type="checkbox" aria-label={`Select ${item.text}`} checked={props.ticked} onChange={props.onTick} />
          <span>{item.text}</span>
        </label>
        <span className="pit-subgroup-tag" data-subgroup={item.subgroup}>{item.subgroup}</span>
      </div>
      <div className="pit-item-tools">
        <div className="pit-chips">
          {item.assignee_ids.map((id) => <span key={id} className="person-chip">{props.nameOf(id)}</span>)}
          {item.assignee_ids.length === 0 && <span className="note">Nobody yet</span>}
        </div>
      </div>
    </li>
  )
}

// "Move to…" in an item's three-dot menu. A dropdown with a box for the
// position and a Move button. A wrong position is explained right under the
// box, so it's seen while the menu is open. `group` makes it close when
// another dropdown in the same menu opens.
function PitMoveTo(props: { name: string; place: number; count: number; group: string; onMove: (place: string) => Promise<string> }) {
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const id = useId()
  return (
    <details className="pit-submenu" name={props.group} onToggle={(event) => { if (event.currentTarget.open) input.current?.focus() }}>
      <summary>Move to…</summary>
      <form className="pit-move-to" onSubmit={async (event) => {
        event.preventDefault()
        const form = event.currentTarget
        const problem = Number(text) === props.place ? `It's already at position ${props.place}.` : await props.onMove(text)
        setError(problem)
        if (problem) {
          input.current?.focus()
          return
        }
        setText('')
        const menu = form.closest('.pit-menu')
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
