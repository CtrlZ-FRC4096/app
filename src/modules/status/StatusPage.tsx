import { useRef, useState, type FormEvent } from 'react'
import { Bar, PageHead, Panel, Pill } from '../../core/ui'
import { MAX_ITEM_LENGTH, PIT_SUBGROUPS, type PitSubgroup, addPitItem, assignPitItem, movePitItem, setPitItemCompleted, usePitChecklist, useSubgroupMembers, belongsToSubgroup, setSubgroupMembers } from './data'
import { useMembers } from '../../core/members'
import { isMentor, useSession } from '../../core/session'
import { usePitDrag } from './usePitDrag'
import { ItemPopup, type ItemPopupMode } from './ItemPopup'
import './status.css'

export default function StatusPage() {
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
  const drag = usePitDrag((error, announcement) => {
    setError(error)
    setAnnouncement(announcement)
  })

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
    <>
      <PageHead eyebrow="Robot status" title="Pit checklist">
        Drag the handle on the right to reorder items. Only assigned people can check or uncheck an item. Mentors can change assignments in the three-dot menu.
      </PageHead>
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
        <ul className="pit-checklist">
          {items.map((item) => (
            <li key={item.id} data-pit-id={item.id} className={drag.activeId === item.id ? 'pit-dragging' : undefined} style={drag.style(item.id)}>
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
                  {isMentor(user.role) && <details className="pit-menu" onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      event.currentTarget.open = false
                      event.currentTarget.querySelector('summary')?.focus()
                    }
                  }}>
                    <summary aria-label={`More options for ${item.text}`} title="More options">⋯</summary>
                    <div className="pit-menu-content">
                    <details className="pit-submenu" name={`pit-tools-${item.id}`}>
                    <summary>Person assignment</summary>
                    <div className="pit-assign">
                      <strong>Assign people</strong>
                      <p className="note">Selections save automatically and mark this item incomplete. Clear all to leave it unassigned.</p>
                      <p className="note">Showing {item.subgroup ?? 'General'} members only.</p>
                      {membersFor(item.subgroup ?? 'General').length === 0 && <p className="note">No active members in this subgroup. Edit subgroup members below.</p>}
                      {membersFor(item.subgroup ?? 'General').map((member) => <label key={member.id} className="check">
                        <input type="checkbox" checked={item.assigneeIds?.includes(member.id) ?? false} onChange={(event) => {
                          const ids = event.target.checked ? [...(item.assigneeIds ?? []), member.id] : (item.assigneeIds ?? []).filter((id) => id !== member.id)
                          const result = assignPitItem(item.id, ids)
                          setError(result.ok ? '' : result.error)
                          if (result.ok) setAnnouncement('Assignment saved.')
                        }} />{member.name}
                      </label>)}
                    </div>
                    {(item.subgroup ?? 'General') !== 'General' && <details className="pit-members-editor">
                      <summary>Edit subgroup members</summary>
                      <div className="pit-assign">
                        <p className="note">Applies to all {item.subgroup} items in this browser. Removing people also removes their assignments.</p>
                        {activeMembers.map((member) => <label key={member.id} className="check">
                          <input type="checkbox" checked={subgroupMembers[item.subgroup!]?.includes(member.id) ?? false} onChange={(event) => {
                            const ids = subgroupMembers[item.subgroup!] ?? []
                            const result = setSubgroupMembers(item.subgroup!, event.target.checked ? [...ids, member.id] : ids.filter((id) => id !== member.id))
                            setError(result.ok ? '' : result.error)
                            if (result.ok) setAnnouncement('Subgroup members saved.')
                          }} />{member.name}
                        </label>)}
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
                    </div>
                  </details>}
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
            {membersFor(subgroup).map((member) => <label key={member.id} className="check">
              <input type="checkbox" checked={assigneeIds.includes(member.id)} onChange={(event) => {
                setAssigneeIds(event.target.checked ? [...assigneeIds, member.id] : assigneeIds.filter((id) => id !== member.id))
              }} />{member.name}
            </label>)}
          </fieldset>
          <div className="toolbar">
            <button type="submit" className="btn btn-primary pit-add">Add item</button>
          </div>
        </form>
      </Panel>
    </>
  )
}
