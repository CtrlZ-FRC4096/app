import { useEffect, useRef, useState, type FormEvent } from 'react'
import { shortDate } from '../../core/format'
import { useMemberNames } from '../../core/members'
import { isMentor } from '../../core/roles'
import { useSession } from '../../core/session'
import { toast } from '../../core/toast'
import { Panel, Pill, Stepper } from '../../core/ui'
import { systemsTable } from '../bom/data'
import {
  STATUS_LABEL, STATUS_TONE, addJob, canReadShape, changeJob, cutsTable, readShapes, removeJob, setJobStatus, sheetsTable, sheetsWithRoom,
  stockTable, useBoard, useMadeParts, type BoardJob, type JobStatus,
} from './data'
import { designChecks, guessStock, inches, minutesText, routerMinutes, sizeText } from './geometry'

/**
 * The CNC board: parts waiting to be cut, grouped by the stock they're cut
 * from, then what's been cut lately. Anyone on the team adds parts and moves
 * them along; only mentors take them off the board.
 */
export function Board(props: { onOpenSheet: (id: string) => void }) {
  const { groups, lately } = useBoard()
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [reading, setReading] = useState(false)
  const nameOf = useMemberNames()
  const open = groups.flatMap((g) => g.jobs)
  const readable = open.map((b) => b.part).filter(canReadShape)

  async function updateSizes() {
    setReading(true)
    const result = await readShapes(readable)
    setReading(false)
    toast(result.ok ? result.value : result.error)
  }

  return (
    <>
      <div className="toolbar">
        {!adding && <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>Add parts</button>}
        {readable.length > 0 && (
          <button type="button" className="btn btn-sm" disabled={reading} onClick={() => void updateSizes()}>
            {reading ? 'Reading Onshape…' : 'Update sizes from Onshape'}
          </button>
        )}
        <span className="note">Add made parts here, or from the BOM. Sizes, outlines and checks come from Onshape.</span>
      </div>

      {adding && <AddJobForm onDone={() => setAdding(false)} />}

      {groups.length === 0 && (
        <Panel>
          <p className="panel-body muted">Nothing waiting to cut. Add parts above, or with "Add to CNC board" on a made part in the BOM.</p>
        </Panel>
      )}

      {groups.map((group) => {
        const count = (status: JobStatus) => group.jobs.filter((b) => b.job.status === status).reduce((total, b) => total + b.job.quantity, 0)
        const minutes = group.jobs.reduce((total, b) => total + (b.shape && b.stock ? (routerMinutes(b.shape, b.stock) ?? 0) * b.job.quantity : 0), 0)
        const counts = [count('to_cut') && `${count('to_cut')} to cut`, count('cutting') && `${count('cutting')} cutting`, minutes >= 1 && `${minutesText(minutes)} on the router`]
        return (
          <Panel
            key={group.stock?.id ?? 'none'}
            title={group.stock ? group.stock.name : 'No stock picked'}
            aside={<span className="note">{counts.filter(Boolean).join(' · ')}</span>}
          >
            <div className="row-list">
              {group.jobs.map((b) =>
                editing === b.job.id ? (
                  <EditJobForm key={b.job.id} item={b} onDone={() => setEditing(null)} />
                ) : (
                  <JobRow key={b.job.id} item={b} onEdit={() => setEditing(b.job.id)} onOpenSheet={props.onOpenSheet} />
                ),
              )}
            </div>
          </Panel>
        )
      })}

      <Panel title="Cut lately" aside={<span className="note">Last 2 weeks</span>}>
        {lately.length === 0 ? (
          <p className="panel-body muted">Nothing cut in the last two weeks.</p>
        ) : (
          <div className="row-list">
            {lately.map((b) => (
              <div key={b.job.id} style={{ flexWrap: 'wrap' }}>
                <Pill tone="ok">Cut</Pill>
                <span style={{ minWidth: 0, flex: '1 1 220px', overflowWrap: 'anywhere' }}>
                  <strong>{b.part?.name ?? 'A deleted part'}</strong> ×{b.job.quantity}
                  <span className="note"> · {b.stock?.name ?? 'no stock picked'} · by {nameOf(b.job.status_by)}, {shortDate(b.job.status_at)}</span>
                </span>
                <button
                  type="button"
                  className="link-btn"
                  onClick={async () => {
                    const result = await setJobStatus(b.job, 'cutting')
                    toast(result.ok ? 'Moved back to Cutting. Cuts already recorded on sheets stay: delete them there if they weren\'t cut.' : result.error)
                  }}
                >
                  Not cut yet
                </button>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </>
  )
}

/** One part on the board: what it is, its size and checks from Onshape, and buttons to move it along. */
function JobRow(props: { item: BoardJob; onEdit: () => void; onOpenSheet: (id: string) => void }) {
  const { job, part, system, stock, shape } = props.item
  const sheets = sheetsTable.useRows()
  const cuts = cutsTable.useRows()
  const [reading, setReading] = useState(false)
  const minutes = shape && stock ? routerMinutes(shape, stock) : null
  const checks = shape && stock ? designChecks(shape, stock, sheets.filter((s) => s.stock_id === stock.id && s.status !== 'scrap')) : []
  const roomOn = job.status === 'to_cut' ? sheetsWithRoom(shape, stock, sheets, cuts) : []
  const planned = cuts.filter((c) => c.job_id === job.id)

  async function move(status: JobStatus) {
    const result = await setJobStatus(job, status)
    if (!result.ok) toast(result.error)
    else if (status === 'cut') toast(planned.some((c) => c.status === 'planned') ? 'Marked cut, and recorded on its sheet.' : 'Marked cut.')
  }

  async function readSize() {
    if (!part) return
    setReading(true)
    const result = await readShapes([part])
    setReading(false)
    toast(result.ok ? result.value : result.error)
  }

  return (
    <div style={{ flexWrap: 'wrap', alignItems: 'flex-start' }}>
      <Pill tone={STATUS_TONE[job.status]}>{STATUS_LABEL[job.status]}</Pill>
      <span style={{ minWidth: 0, flex: '1 1 260px', overflowWrap: 'anywhere' }}>
        <button type="button" className="name-btn" onClick={props.onEdit}><strong>{part?.name ?? 'A deleted part'}</strong></button> ×{job.quantity}
        <br />
        <span className="note">
          {part && <span className="mono">{part.part_number}</span>}
          {system && ` · ${system.name}`}
          {/* The database only accepts https:// links here, so they're safe to open. */}
          {part?.onshape_url && <> · <a href={part.onshape_url} target="_blank" rel="noopener noreferrer">Part in Onshape</a></>}
          {system?.onshape_url && <> · <a href={system.onshape_url} target="_blank" rel="noopener noreferrer">Assembly</a></>}
        </span>
        {job.note && (
          <>
            <br />
            <span className="note">“{job.note}”</span>
          </>
        )}
        <br />
        <span className="note">
          {shape ? (
            <>
              {sizeText(shape.length_in, shape.width_in)}, {inches(shape.thickness_in)} thick
              {minutes !== null && ` · ${minutesText(minutes)} each${job.quantity > 1 ? `, ${minutesText(minutes * job.quantity).replace('about ', '')} for ${job.quantity}` : ''}`}
            </>
          ) : canReadShape(part) ? (
            'No size yet: read it from Onshape.'
          ) : (
            'Typed in, not from Onshape, so no size or checks.'
          )}
        </span>
        {checks.length > 0 && (
          <span style={{ display: 'grid', gap: 4, marginTop: 6 }}>
            {checks.map((check) => (
              <span key={check.text} className="note">
                <Pill tone={check.tone}>{check.tone === 'crit' ? 'Fix' : check.tone === 'warn' ? 'Check' : 'Note'}</Pill> {check.text}
              </span>
            ))}
          </span>
        )}
        {(roomOn.length > 0 || planned.length > 0) && (
          <>
            <br />
            <span className="note">
              {planned.length > 0 ? 'Planned on ' : 'Room on '}
              {(planned.length > 0 ? sheets.filter((s) => planned.some((c) => c.sheet_id === s.id)) : roomOn.slice(0, 4)).map((s, i) => (
                <span key={s.id}>
                  {i > 0 && ', '}
                  <button type="button" className="link-btn mono" onClick={() => props.onOpenSheet(s.id)}>{s.label}</button>
                </span>
              ))}
            </span>
          </>
        )}
      </span>
      <span className="toolbar" style={{ marginLeft: 'auto' }}>
        {job.status === 'to_cut' && <button type="button" className="btn btn-sm" onClick={() => void move('cutting')}>Start cutting</button>}
        {job.status === 'cutting' && (
          <>
            <button type="button" className="btn btn-sm btn-primary" onClick={() => void move('cut')}>Mark cut</button>
            <button type="button" className="btn btn-sm" onClick={() => void move('to_cut')}>Not yet</button>
          </>
        )}
        {!shape && canReadShape(part) && (
          <button type="button" className="btn btn-sm" disabled={reading} onClick={() => void readSize()}>{reading ? 'Reading…' : 'Read from Onshape'}</button>
        )}
      </span>
    </div>
  )
}

/** Change a job's quantity, stock or note. Mentors can also take it off the board. */
function EditJobForm(props: { item: BoardJob; onDone: () => void }) {
  const { job, part } = props.item
  const user = useSession()
  const stocks = stockTable.useRows()
  const [quantity, setQuantity] = useState(job.quantity)
  const [stockId, setStockId] = useState(job.stock_id ?? '')
  const [note, setNote] = useState(job.note ?? '')
  const [saving, setSaving] = useState(false)

  async function save(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    const result = await changeJob(job, { quantity, stock_id: stockId || null, note })
    setSaving(false)
    toast(result.ok ? 'Saved.' : result.error)
    if (result.ok) props.onDone()
  }

  async function remove() {
    if (!window.confirm(`Take ${part?.name ?? 'this part'} off the CNC board?`)) return
    const result = await removeJob(job)
    toast(result.ok ? 'Taken off the board.' : result.error)
    if (result.ok) props.onDone()
  }

  return (
    <form onSubmit={save} style={{ display: 'grid', gap: 10 }} aria-label={`Change ${part?.name ?? 'job'}`}>
      <strong>{part?.name ?? 'A deleted part'}</strong>
      <div className="toolbar">
        <div className="field">
          How many
          <Stepper id={`job-qty-${job.id}`} label="How many" min={1} value={quantity} onChange={setQuantity} />
        </div>
        <StockSelect id={`job-stock-${job.id}`} value={stockId} onChange={setStockId} stocks={stocks} />
      </div>
      <label className="field" htmlFor={`job-note-${job.id}`}>
        Note (optional)
        <input id={`job-note-${job.id}`} className="input" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="Spare, rush for Saturday…" />
      </label>
      <div className="toolbar">
        <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>Save</button>
        <button type="button" className="btn btn-sm" onClick={props.onDone}>Cancel</button>
        {isMentor(user.role) && <button type="button" className="btn btn-sm" style={{ marginLeft: 'auto' }} onClick={() => void remove()}>Take off the board</button>}
      </div>
    </form>
  )
}

/** Pick a kind of stock, or none yet. */
function StockSelect(props: { id: string; value: string; onChange: (id: string) => void; stocks: { id: string; name: string }[]; label?: string }) {
  return (
    <label className="field" htmlFor={props.id}>
      {props.label ?? 'Cut from'}
      <select id={props.id} className="input" value={props.value} onChange={(e) => props.onChange(e.target.value)}>
        <option value="">Not picked yet</option>
        {props.stocks.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
    </label>
  )
}

/** Put made parts on the board: pick a system and part, how many, and the stock (guessed from the part's material). */
function AddJobForm(props: { onDone: () => void }) {
  const parts = useMadeParts()
  const systems = systemsTable.useRows().filter((s) => parts.some((p) => p.system_id === s.id))
  const stocks = stockTable.useRows()
  const [systemId, setSystemId] = useState(systems[0]?.id ?? '')
  const inSystem = parts.filter((p) => p.system_id === systemId)
  const [partId, setPartId] = useState('')
  const part = inSystem.find((p) => p.id === partId)
  const [quantity, setQuantity] = useState(1)
  // Null until someone picks one: until then, the stock guessed from the part's material.
  const [stockId, setStockId] = useState<string | null>(null)
  const shownStock = stockId ?? guessStock(part?.material ?? null, stocks)?.id ?? ''
  const [saving, setSaving] = useState(false)
  const ref = useRef<HTMLFormElement>(null)
  useEffect(() => ref.current?.querySelector('select')?.focus(), [])

  function pickPart(id: string) {
    setPartId(id)
    setQuantity(inSystem.find((p) => p.id === id)?.quantity ?? 1)
    setStockId(null)
  }

  async function add(event: FormEvent) {
    event.preventDefault()
    if (!part) {
      toast('Pick a part first.')
      return
    }
    setSaving(true)
    const result = await addJob(part, quantity, shownStock || null)
    setSaving(false)
    if (!result.ok) {
      toast(result.error)
      return
    }
    toast(result.value.added ? `Added ${part.name} ×${quantity}.` : `${part.name} was already waiting: now ${result.value.job.quantity} to cut.`)
    setPartId('')
    setStockId(null)
  }

  return (
    <Panel title="Add parts to the board">
      <form ref={ref} className="panel-body" onSubmit={add}>
        {parts.length === 0 ? (
          <p className="muted">There are no made parts in the BOM yet. Add them there first, or import them from Onshape.</p>
        ) : (
          <>
            <div className="toolbar">
              <label className="field" htmlFor="job-system">
                System
                <select id="job-system" className="input" value={systemId} onChange={(e) => { setSystemId(e.target.value); pickPart('') }}>
                  {systems.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </label>
              <label className="field" htmlFor="job-part" style={{ flex: '1 1 220px' }}>
                Part
                <select id="job-part" className="input" value={partId} onChange={(e) => pickPart(e.target.value)}>
                  <option value="">Pick a part</option>
                  {inSystem.map((p) => <option key={p.id} value={p.id}>{p.part_number} {p.name}</option>)}
                </select>
              </label>
            </div>
            {part && <p className="note">{part.material ? `${part.material}.` : 'No material in the BOM yet.'} The BOM says {part.quantity} on the robot.</p>}
            <div className="toolbar">
              <div className="field">
                How many
                <Stepper id="job-quantity" label="How many" min={1} value={quantity} onChange={setQuantity} />
              </div>
              <StockSelect id="job-stock" value={shownStock} onChange={setStockId} stocks={stocks} />
            </div>
            {part && !stockId && shownStock && <p className="note">Stock guessed from the material in the BOM. Change it if it's wrong.</p>}
          </>
        )}
        <div className="toolbar">
          {parts.length > 0 && <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Adding…' : 'Add to board'}</button>}
          <button type="button" className="btn" onClick={props.onDone}>Done</button>
          {stocks.length === 0 && <span className="note">No stock yet: a mentor adds it under Stock.</span>}
        </div>
      </form>
    </Panel>
  )
}
