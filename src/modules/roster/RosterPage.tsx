import { useState, type FormEvent } from 'react'
import { toast } from '../../core/toast'
import { PageHead, Panel, Pick, Pill } from '../../core/ui'
import { plural } from '../../core/format'
import { roleName } from '../../core/session'
import {
  addSubteam, MAX_SUBTEAM_NAME, removeSubteam, renameSubteam, setActive, setMainSubteam, setOnSubteam, useRoster, useSubteams,
  type RosterEntry, type Subteam,
} from './data'

const SHOW = ['Everyone', 'Active', 'Not active'] as const
type Show = (typeof SHOW)[number]
/** The subteam filter's choices besides each subteam. */
const ALL = 'all'
const NONE = 'none'

// Mentors and admins only (roles in index.ts; the database checks too).
// Pages only show; every change goes through data.ts.
export default function RosterPage() {
  const roster = useRoster()
  const subteams = useSubteams()
  const [search, setSearch] = useState('')
  const [show, setShow] = useState<Show>('Everyone')
  const [subteam, setSubteam] = useState(ALL)

  const wanted = search.trim().toLowerCase()
  const shown = roster.filter(
    (e) =>
      e.member.name.toLowerCase().includes(wanted) &&
      (show === 'Everyone' || e.active === (show === 'Active')) &&
      (subteam === ALL || (subteam === NONE ? e.subteams.length === 0 : e.subteams.includes(subteam))),
  )
  const active = roster.filter((e) => e.active)

  return (
    <>
      <PageHead title="Roster">
        Who's active this season, and their subteams. Active students and student leaders have to come to the required Monday meetings
        (see Attendance). Everyone with the Student or Student leader role and access on is listed here.
      </PageHead>

      <Panel title="This season">
        <div className="stats" aria-label="Active students by subteam">
          <div><strong>{active.length}</strong><span>active of {roster.length}</span></div>
          {subteams.map((s) => (
            <div key={s.id}><strong>{active.filter((e) => e.subteams.includes(s.id)).length}</strong><span>{s.name}</span></div>
          ))}
        </div>
      </Panel>

      <div className="toolbar">
        <label className="field" htmlFor="roster-search">
          Find someone
          <input id="roster-search" className="input" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name" />
        </label>
        <label className="field" htmlFor="roster-subteam">
          Subteam
          <select id="roster-subteam" className="input" value={subteam} onChange={(e) => setSubteam(e.target.value)}>
            <option value={ALL}>All subteams</option>
            {subteams.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            <option value={NONE}>No subteam yet</option>
          </select>
        </label>
      </div>
      <Pick label="Show" options={[...SHOW]} value={show} onChange={setShow} />

      <Panel title="Students" aside={<span className="note">{plural(shown.length, 'person', 'people')} shown</span>}>
        {shown.length === 0 ? (
          <p className="panel-body muted">
            {roster.length === 0
              ? 'Nobody yet. Students show up here once they sign in, with the Student or Student leader role (Members page).'
              : 'Nobody matches. Change the search or filters.'}
          </p>
        ) : (
          <div className="row-list">
            {shown.map((entry) => <StudentRow key={entry.member.id} entry={entry} subteams={subteams} />)}
          </div>
        )}
      </Panel>

      <SubteamsPanel subteams={subteams} roster={roster} />
    </>
  )
}

/** One student: active or not, their subteams, and their main one. */
function StudentRow(props: { entry: RosterEntry; subteams: Subteam[] }) {
  const { entry, subteams } = props
  const [busy, setBusy] = useState(false)
  const name = entry.member.name

  async function run(change: Promise<{ ok: true } | { ok: false; error: string }>) {
    setBusy(true)
    const result = await change
    setBusy(false)
    if (!result.ok) toast(result.error)
  }

  return (
    <div style={{ flexWrap: 'wrap', alignItems: 'flex-start' }}>
      <span style={{ minWidth: 0, flex: '1 1 180px', overflowWrap: 'anywhere' }}>
        <strong>{name}</strong>
        {entry.member.role !== 'student' && <> <Pill tone="info">{roleName(entry.member.role)}</Pill></>}
        <br />
        <label className="check">
          <input type="checkbox" checked={entry.active} disabled={busy} onChange={(e) => void run(setActive(entry.member, e.target.checked))} />
          Active this season
        </label>
      </span>
      <span style={{ display: 'grid', gap: 8, flex: '2 1 280px', minWidth: 0 }}>
        <div className="pick" role="group" aria-label={`${name}'s subteams`}>
          {subteams.map((s) => {
            const on = entry.subteams.includes(s.id)
            return (
              <button key={s.id} type="button" aria-pressed={on} disabled={busy} onClick={() => void run(setOnSubteam(entry.member, s.id, !on))}>
                {s.name}
              </button>
            )
          })}
        </div>
        {entry.subteams.length > 1 && (
          <label className="field" htmlFor={`main-${entry.member.id}`}>
            Main subteam
            <select
              id={`main-${entry.member.id}`}
              className="input"
              value={entry.main ?? ''}
              disabled={busy}
              onChange={(e) => void run(setMainSubteam(entry.member, e.target.value))}
            >
              {entry.subteams.map((id) => <option key={id} value={id}>{subteams.find((s) => s.id === id)?.name ?? 'Removed subteam'}</option>)}
            </select>
          </label>
        )}
        {entry.subteams.length === 0 && <span className="note">No subteam yet: tap one above.</span>}
      </span>
    </div>
  )
}

/** The subteams: how many are on each, and adding, renaming and removing them. */
function SubteamsPanel(props: { subteams: Subteam[]; roster: RosterEntry[] }) {
  const [adding, setAdding] = useState('')
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null)
  // The subteam whose Remove was pressed once: it takes two presses.
  const [removing, setRemoving] = useState<string | null>(null)

  async function add(event: FormEvent) {
    event.preventDefault()
    const result = await addSubteam(adding)
    if (!result.ok) return toast(result.error)
    toast(`Added ${result.value.name}.`)
    setAdding('')
  }

  async function rename(event: FormEvent, subteam: Subteam) {
    event.preventDefault()
    if (!renaming) return
    const result = await renameSubteam(subteam, renaming.name)
    if (!result.ok) return toast(result.error)
    setRenaming(null)
  }

  async function remove(subteam: Subteam) {
    if (removing !== subteam.id) return setRemoving(subteam.id)
    setRemoving(null)
    const result = await removeSubteam(subteam)
    toast(result.ok ? `Removed ${subteam.name}.` : result.error)
  }

  return (
    <Panel title="Subteams">
      <div className="row-list">
        {props.subteams.map((s) => {
          const count = props.roster.filter((e) => e.subteams.includes(s.id)).length
          return renaming?.id === s.id ? (
            <form key={s.id} className="toolbar" onSubmit={(e) => void rename(e, s)} aria-label={`Rename ${s.name}`}>
              <input className="input" aria-label="New name" maxLength={MAX_SUBTEAM_NAME} value={renaming.name} onChange={(e) => setRenaming({ id: s.id, name: e.target.value })} />
              <button type="submit" className="btn btn-sm btn-primary">Save</button>
              <button type="button" className="btn btn-sm" onClick={() => setRenaming(null)}>Cancel</button>
            </form>
          ) : (
            <div key={s.id} style={{ flexWrap: 'wrap' }}>
              <span style={{ minWidth: 0, flex: '1 1 160px' }}>
                <strong>{s.name}</strong> <span className="note">· {plural(count, 'person', 'people')}</span>
              </span>
              <button type="button" className="btn btn-sm" onClick={() => setRenaming({ id: s.id, name: s.name })}>Rename</button>
              <button type="button" className="btn btn-sm" onClick={() => void remove(s)}>
                {removing === s.id ? (count ? `Press again: takes ${plural(count, 'person', 'people')} off it` : 'Press again to remove') : 'Remove'}
              </button>
            </div>
          )
        })}
      </div>
      <form className="panel-body toolbar" onSubmit={(e) => void add(e)}>
        <label className="field" htmlFor="roster-new-subteam" style={{ flex: '1 1 200px' }}>
          Add a subteam
          <input id="roster-new-subteam" className="input" maxLength={MAX_SUBTEAM_NAME} value={adding} onChange={(e) => setAdding(e.target.value)} placeholder="Business" />
        </label>
        <button type="submit" className="btn btn-primary">Add</button>
      </form>
    </Panel>
  )
}
