import { useEffect, useRef, useState, type FormEvent } from 'react'
import { plural, shortDate } from '../../core/format'
import { useMemberNames } from '../../core/members'
import { isMentor } from '../../core/roles'
import { useSession } from '../../core/session'
import { toast } from '../../core/toast'
import { Bar, Panel, Pill } from '../../core/ui'
import { partsTable } from '../bom/data'
import {
  SHEET_STATUS_LABEL, SHEET_STATUS_TONE, STATUS_LABEL, addManualCut, addSheet, boxOf, canRemoveCut, changeSheet, cutsTable, jobsTable, markCut, planRoom,
  readLayout, removeCut, removeSheet, saveRoomPlan, setSheetStatus, shapesTable, sheetForm, sheetsTable, spacing, splitRemnant, stockTable,
  useSheetViews, type Cut, type CutStatus, type LayoutPlan, type NewSheet, type RoomPlan, type Sheet, type SheetView,
} from './data'
import { biggestClearPiece, flatOutline, inches, quarterTurn, sizeText, usedShare } from './geometry'
import { SheetDrawing, type Drawn } from './SheetDrawing'

/**
 * The sheets on the rack. Choose one to see what's been cut from it, drawn
 * to scale, and to record cuts, find room for waiting parts, or cut off a
 * leftover piece.
 */
export function Sheets(props: { openId: string | null; onOpen: (id: string | null) => void }) {
  const views = useSheetViews()
  const stocks = stockTable.useRows()
  const [stockId, setStockId] = useState('')
  const [showScrap, setShowScrap] = useState(false)
  const [adding, setAdding] = useState(false)
  const open = views.find((v) => v.sheet.id === props.openId)
  const shown = views.filter((v) => (!stockId || v.sheet.stock_id === stockId) && (showScrap || v.sheet.status !== 'scrap'))
  const plates = stocks.filter((s) => s.kind === 'plate')

  return (
    <>
      <div className="toolbar">
        <label className="field" htmlFor="sheet-filter">
          Stock
          <select id="sheet-filter" className="input" value={stockId} onChange={(e) => setStockId(e.target.value)}>
            <option value="">All stock</option>
            {plates.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <label className="check"><input type="checkbox" checked={showScrap} onChange={(e) => setShowScrap(e.target.checked)} /> Show scrap</label>
        {!adding && <button type="button" className="btn btn-primary" style={{ marginLeft: 'auto' }} onClick={() => setAdding(true)}>Add a sheet</button>}
      </div>

      {adding && (
        <SheetForm
          title="Add a sheet"
          initial={sheetForm(stocks.find((s) => s.id === stockId) ?? plates[0], sheetsTable.rows())}
          onCancel={() => setAdding(false)}
          onSave={async (input) => {
            const result = await addSheet(input)
            if (!result.ok) return result.error
            toast(`Added ${result.value.label}. Write it on the sheet.`)
            setAdding(false)
            props.onOpen(result.value.id)
            return null
          }}
        />
      )}

      {open && <SheetDetail key={open.sheet.id} view={open} onClose={() => props.onOpen(null)} onOpen={props.onOpen} />}

      <Panel title="Sheets" aside={<span className="note">{plural(shown.length, 'sheet', 'sheets')}</span>}>
        {shown.length === 0 ? (
          <p className="panel-body muted">{views.length === 0 ? 'No sheets yet. Add one when stock comes in, and write its ID on it.' : 'No sheets match.'}</p>
        ) : (
          <div className="row-list">
            {shown.map((v) => {
              const used = usedShare(v.sheet, v.cuts.map(boxOf))
              return (
                <div key={v.sheet.id} style={{ flexWrap: 'wrap' }} aria-current={v.sheet.id === props.openId || undefined}>
                  <span style={{ minWidth: 0, flex: '1 1 220px', overflowWrap: 'anywhere' }}>
                    <button type="button" className="name-btn mono" onClick={() => props.onOpen(v.sheet.id === props.openId ? null : v.sheet.id)}>
                      <strong>{v.sheet.label}</strong>
                    </button>{' '}
                    <Pill tone={SHEET_STATUS_TONE[v.sheet.status]}>{SHEET_STATUS_LABEL[v.sheet.status]}</Pill>
                    <br />
                    <span className="note">
                      {v.stock?.name ?? 'Unknown stock'} · {sizeText(v.sheet.length_in, v.sheet.width_in)}
                      {v.sheet.location && ` · ${v.sheet.location}`}
                    </span>
                  </span>
                  <span style={{ flex: '0 1 140px', display: 'grid', gap: 4 }}>
                    <Bar value={used} label={`${v.sheet.label} used`} />
                    <span className="note">
                      {Math.round(used * 100)}% used
                      {v.cuts.some((c) => c.status === 'planned') && ` · ${v.cuts.filter((c) => c.status === 'planned').length} planned`}
                    </span>
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </Panel>
    </>
  )
}

type Opened = 'cut' | 'room' | 'change' | 'remnant' | null

/** One sheet: its drawing, its cuts, and what can be done with it. */
function SheetDetail(props: { view: SheetView; onClose: () => void; onOpen: (id: string) => void }) {
  const { sheet, stock, cuts, parent } = props.view
  const user = useSession()
  const nameOf = useMemberNames()
  const parts = partsTable.useRows()
  const jobs = jobsTable.useRows()
  const children = sheetsTable.useRows().filter((s) => s.parent_id === sheet.id)
  const [selected, setSelected] = useState<string | null>(null)
  const [opened, setOpened] = useState<Opened>(null)
  const [room, setRoom] = useState<RoomPlan | null>(null)
  const [skipped, setSkipped] = useState<LayoutPlan['skipped'] | null>(null)
  const [reading, setReading] = useState(false)
  const chosen = cuts.find((c) => c.id === selected)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => ref.current?.scrollIntoView({ block: 'nearest' }), [])

  const items: Drawn[] = [
    ...cuts.map((c): Drawn => ({ id: c.id, name: c.name, box: boxOf(c), outline: c.outline, kind: c.status === 'cut' ? 'cut' : 'planned' })),
    ...(room?.spots ?? []).map(({ part, shape, spot }, i): Drawn => ({
      id: `room-${i}`, name: part.name, box: spot.box, kind: 'preview',
      outline: shape.outline.length ? (spot.turned ? quarterTurn(flatOutline(shape)) : flatOutline(shape)) : null,
    })),
  ]

  function toggle(form: Opened) {
    setOpened(opened === form ? null : form)
    if (form !== 'room') setRoom(null)
  }

  async function layout() {
    setReading(true)
    const result = await readLayout(sheet)
    setReading(false)
    if (!result.ok) {
      toast(result.error)
      return
    }
    const { planned, skipped: left, shapes } = result.value
    toast(`Planned ${plural(planned, 'part', 'parts')} from the Onshape layout.${shapes ? ` ${shapes}` : ''}`)
    setSkipped(left)
  }

  function findRoom() {
    // Every cut, not just this sheet's: parts planned on other sheets aren't waiting any more.
    const plan = planRoom(sheet, stock, jobsTable.rows(), partsTable.rows(), shapesTable.rows(), cutsTable.rows())
    setRoom(plan)
    setOpened('room')
    setSelected(null)
  }

  async function scrap(status: Sheet['status']) {
    const result = await setSheetStatus(sheet, status)
    toast(result.ok ? (status === 'scrap' ? `${sheet.label} is scrap now.` : `${sheet.label} is back on the rack.`) : result.error)
  }

  async function remove() {
    if (!window.confirm(`Delete ${sheet.label} and its ${plural(cuts.length, 'cut', 'cuts')}? Marking it scrap keeps its history.`)) return
    const result = await removeSheet(sheet)
    toast(result.ok ? `Deleted ${sheet.label}.` : result.error)
    if (result.ok) props.onClose()
  }

  return (
    <div ref={ref}>
      <Panel
        title={
          <h2>
            <span className="mono">{sheet.label}</span> <Pill tone={SHEET_STATUS_TONE[sheet.status]}>{SHEET_STATUS_LABEL[sheet.status]}</Pill>
          </h2>
        }
        aside={<button type="button" className="btn btn-sm" onClick={props.onClose}>Close</button>}
      >
        <p className="panel-body note" style={{ paddingBottom: 0 }}>
          {stock?.name ?? 'Unknown stock'} · {sizeText(sheet.length_in, sheet.width_in)}
          {sheet.location && ` · ${sheet.location}`}
          {parent && <> · cut from <button type="button" className="link-btn mono" onClick={() => props.onOpen(parent.id)}>{parent.label}</button></>}
          {children.length > 0 && (
            <>
              {' · left over: '}
              {children.map((c, i) => (
                <span key={c.id}>{i > 0 && ', '}<button type="button" className="link-btn mono" onClick={() => props.onOpen(c.id)}>{c.label}</button></span>
              ))}
            </>
          )}
          {sheet.note && <> · “{sheet.note}”</>}
        </p>

        <div className="panel-body">
          <SheetDrawing
            length={sheet.length_in}
            width={sheet.width_in}
            items={items}
            selected={selected}
            onSelect={(id) => {
              setSelected(id)
              if (id) setOpened(null)
            }}
            label={`${sheet.label}, ${sizeText(sheet.length_in, sheet.width_in)}, with ${plural(cuts.length, 'cut', 'cuts')}. Tap one for details.`}
          />
          <p className="note" style={{ marginTop: 6 }}>
            Drawn to scale. The orange dot is the corner at the Onshape layout's origin: x runs along the {inches(sheet.length_in)} side, y up the {inches(sheet.width_in)} side.
            Solid outlines are cut; dashed ones are planned. Tap one for details.
          </p>
        </div>

        {chosen && <CutDetails cut={chosen} onDone={() => setSelected(null)} canRemove={canRemoveCut(chosen, user)} nameOf={nameOf} parts={parts} jobs={jobs} />}

        <div className="panel-body toolbar">
          {sheet.onshape_url && (
            <button type="button" className="btn btn-sm" disabled={reading} onClick={() => void layout()}>{reading ? 'Reading Onshape…' : 'Read layout from Onshape'}</button>
          )}
          {/* The database only accepts https://cad.onshape.com links here, so it's safe to open. */}
          {sheet.onshape_url && <a href={sheet.onshape_url} target="_blank" rel="noopener noreferrer">Open layout</a>}
          {sheet.status !== 'scrap' && <button type="button" className="btn btn-sm" aria-pressed={opened === 'room'} onClick={() => (opened === 'room' ? toggle('room') : findRoom())}>Find room</button>}
          <button type="button" className="btn btn-sm" aria-pressed={opened === 'cut'} onClick={() => toggle('cut')}>Add a cut</button>
          {sheet.status !== 'scrap' && <button type="button" className="btn btn-sm" aria-pressed={opened === 'remnant'} onClick={() => toggle('remnant')}>Cut off a remnant</button>}
          <button type="button" className="btn btn-sm" aria-pressed={opened === 'change'} onClick={() => toggle('change')}>Change sheet</button>
          {sheet.status === 'scrap' ? (
            <button type="button" className="btn btn-sm" onClick={() => void scrap(cuts.some((c) => c.status === 'cut') ? 'partly_used' : 'new')}>Not scrap</button>
          ) : (
            <button type="button" className="btn btn-sm" onClick={() => void scrap('scrap')}>Mark scrap</button>
          )}
          {isMentor(user.role) && <button type="button" className="btn btn-sm" style={{ marginLeft: 'auto' }} onClick={() => void remove()}>Delete sheet</button>}
        </div>
        <p className="panel-body note" style={{ paddingTop: 0 }}>
          {sheet.onshape_url
            ? sheet.layout_read_at
              ? `Layout last read ${shortDate(sheet.layout_read_at)}. Parts laid out on it become planned cuts, and are recorded when they're marked cut on the board.`
              : 'Read the layout to plan its parts on this sheet. They\'re recorded when marked cut on the board.'
            : 'To read cuts from Onshape, lay the parts out on this sheet in an assembly, with the sheet\'s corner at the origin, and add its link with Change sheet.'}
        </p>

        {skipped && skipped.length > 0 && (
          <div className="panel-body">
            <strong>Left out of the layout</strong>
            <ul className="goal-list" style={{ padding: '6px 0 0 18px' }}>
              {skipped.map((s, i) => <li key={i}>{s.name} {s.why}.</li>)}
            </ul>
            <button type="button" className="btn btn-sm" onClick={() => setSkipped(null)}>OK</button>
          </div>
        )}

        {opened === 'room' && room && <RoomResult sheet={sheet} plan={room} gap={spacing(stock)} onDone={() => { setRoom(null); setOpened(null) }} />}
        {opened === 'cut' && <ManualCutForm sheet={sheet} onDone={() => setOpened(null)} />}
        {opened === 'change' && (
          <SheetForm
            title={`Change ${sheet.label}`}
            initial={{ label: sheet.label, stock_id: sheet.stock_id, length: String(sheet.length_in), width: String(sheet.width_in), location: sheet.location ?? '', onshape_url: sheet.onshape_url ?? '', note: sheet.note ?? '' }}
            fixedStock
            onCancel={() => setOpened(null)}
            onSave={async (input) => {
              const result = await changeSheet(sheet, input)
              if (!result.ok) return result.error
              toast('Saved.')
              setOpened(null)
              return null
            }}
          />
        )}
        {opened === 'remnant' && <RemnantForm sheet={sheet} cuts={cuts} gap={spacing(stock)} onDone={(id) => { setOpened(null); if (id) props.onOpen(id) }} />}

        <CutList cuts={cuts} selected={selected} onSelect={setSelected} />
      </Panel>
    </div>
  )
}

/** A cut's details, after tapping it on the drawing. */
function CutDetails(props: {
  cut: Cut
  canRemove: boolean
  onDone: () => void
  nameOf: (id: string | null | undefined) => string
  parts: ReturnType<typeof partsTable.rows>
  jobs: ReturnType<typeof jobsTable.rows>
}) {
  const { cut } = props
  const part = props.parts.find((p) => p.id === cut.part_id)
  const job = props.jobs.find((j) => j.id === cut.job_id)

  async function cutIt() {
    const result = await markCut(cut)
    toast(result.ok ? 'Recorded as cut.' : result.error)
  }

  async function remove() {
    if (!window.confirm(`Delete ${cut.name} from this sheet?`)) return
    const result = await removeCut(cut)
    toast(result.ok ? 'Deleted.' : result.error)
    if (result.ok) props.onDone()
  }

  return (
    <div className="panel-body" style={{ background: 'var(--blue-soft)', display: 'grid', gap: 6 }} aria-live="polite">
      <strong>{cut.name}</strong>
      <span className="note">
        {part && <span className="mono">{part.part_number}</span>}
        {part && ' · '}
        {sizeText(cut.length_in, cut.width_in)} at {inches(cut.x_in)} along, {inches(cut.y_in)} up
        {cut.rotation_deg ? `, turned ${cut.rotation_deg}°` : ''}
      </span>
      <span className="note">
        {cut.status === 'cut' ? `Cut by ${props.nameOf(cut.cut_by)}${cut.cut_at ? `, ${shortDate(cut.cut_at)}` : ''}` : `Planned by ${props.nameOf(cut.created_by)}, ${shortDate(cut.created_at)}`}
        {' · '}
        {cut.source === 'onshape' ? 'from the Onshape layout' : 'entered by hand'}
        {job && ` · on the board: ${STATUS_LABEL[job.status]}`}
      </span>
      <span className="toolbar">
        {/* The database only accepts https:// links here, so it's safe to open. */}
        {part?.onshape_url && <a href={part.onshape_url} target="_blank" rel="noopener noreferrer">Part in Onshape</a>}
        {cut.status === 'planned' && <button type="button" className="btn btn-sm btn-primary" onClick={() => void cutIt()}>Mark cut</button>}
        {props.canRemove && <button type="button" className="btn btn-sm" onClick={() => void remove()}>Delete</button>}
        <button type="button" className="btn btn-sm" onClick={props.onDone}>Close</button>
      </span>
    </div>
  )
}

/** Every cut on the sheet as a list, for reading on a phone or with a screen reader. */
function CutList(props: { cuts: Cut[]; selected: string | null; onSelect: (id: string | null) => void }) {
  if (props.cuts.length === 0) return <p className="panel-body muted">Nothing cut or planned on this sheet yet.</p>
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr><th>Part</th><th>Where</th><th>Size</th></tr>
        </thead>
        <tbody>
          {props.cuts.map((c) => (
            <tr key={c.id} aria-selected={c.id === props.selected}>
              <td>
                <button type="button" className="name-btn" onClick={() => props.onSelect(c.id === props.selected ? null : c.id)}>{c.name}</button>{' '}
                {c.status === 'planned' && <Pill tone="info">Planned</Pill>}
              </td>
              <td className="tnum" style={{ whiteSpace: 'nowrap' }}>{Number(c.x_in.toFixed(2))}, {Number(c.y_in.toFixed(2))}</td>
              <td className="tnum" style={{ whiteSpace: 'nowrap' }}>{sizeText(c.length_in, c.width_in)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Where waiting parts could go, drawn on the sheet, ready to save as planned cuts. */
function RoomResult(props: { sheet: Sheet; plan: RoomPlan; gap: number; onDone: () => void }) {
  const { plan } = props
  const [saving, setSaving] = useState(false)
  const counts = new Map<string, { name: string; n: number }>()
  for (const s of plan.spots) counts.set(s.job.id, { name: s.part.name, n: (counts.get(s.job.id)?.n ?? 0) + 1 })

  async function save() {
    setSaving(true)
    const result = await saveRoomPlan(props.sheet, plan.spots)
    setSaving(false)
    toast(result.ok ? `Planned ${plural(result.value.length, 'part', 'parts')} on ${props.sheet.label}. They're recorded when marked cut on the board.` : result.error)
    if (result.ok) props.onDone()
  }

  return (
    <div className="panel-body" style={{ display: 'grid', gap: 8 }}>
      <strong>Room for waiting parts</strong>
      {plan.spots.length === 0 && plan.noRoom.length === 0 && plan.noShape.length === 0 && (
        <span className="muted">Nothing on the board is waiting for this stock.</span>
      )}
      {plan.spots.length > 0 && (
        <span>
          Fits, shown in orange: {[...counts.values()].map((c) => `${c.name} ×${c.n}`).join(', ')}. Parts are kept {inches(props.gap)} apart, and from the edges.
        </span>
      )}
      {plan.noRoom.map((n) => <span key={n.job.id} className="note">No room for {n.count} more {n.part.name}.</span>)}
      {plan.noShape.map((n) => <span key={n.job.id} className="note">{n.part?.name ?? 'A part'} has no size from Onshape yet, so it's left out. Read it on the board.</span>)}
      <span className="toolbar">
        {plan.spots.length > 0 && <button type="button" className="btn btn-sm btn-primary" disabled={saving} onClick={() => void save()}>Plan them here</button>}
        <button type="button" className="btn btn-sm" onClick={props.onDone}>{plan.spots.length ? 'Cancel' : 'Close'}</button>
      </span>
    </div>
  )
}

/** Record a cut by hand: a part from the board (or anything else), where it is and how big. */
function ManualCutForm(props: { sheet: Sheet; onDone: () => void }) {
  const { sheet } = props
  const jobs = jobsTable.useRows().filter((j) => j.stock_id === sheet.stock_id && j.status !== 'cut')
  const parts = partsTable.useRows()
  const shapes = shapesTable.useRows()
  const [jobId, setJobId] = useState('')
  const [name, setName] = useState('')
  const [x, setX] = useState('')
  const [y, setY] = useState('')
  const [length, setLength] = useState('')
  const [width, setWidth] = useState('')
  const [turned, setTurned] = useState(false)
  const [status, setStatus] = useState<CutStatus>('cut')
  const [saving, setSaving] = useState(false)
  const partOf = (id: string) => parts.find((p) => p.id === jobs.find((j) => j.id === id)?.part_id)

  function pickJob(id: string) {
    setJobId(id)
    const shape = shapes.find((s) => s.part_id === partOf(id)?.id)
    if (shape) {
      setLength(String(turned ? shape.width_in : shape.length_in))
      setWidth(String(turned ? shape.length_in : shape.width_in))
    }
  }

  function turn(on: boolean) {
    setTurned(on)
    setLength(width)
    setWidth(length)
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    const result = await addManualCut(sheet, { jobId, partId: '', name, x, y, length, width, turned, status })
    setSaving(false)
    if (!result.ok) {
      toast(result.error)
      return
    }
    toast(status === 'cut' ? `Recorded ${result.value.name} on ${sheet.label}.` : `Planned ${result.value.name} on ${sheet.label}.`)
    props.onDone()
  }

  return (
    <form className="panel-body" onSubmit={save} aria-label="Add a cut by hand" style={{ display: 'grid', gap: 10 }}>
      <strong>Add a cut by hand</strong>
      <label className="field" htmlFor="cut-job">
        Part
        <select id="cut-job" className="input" value={jobId} onChange={(e) => pickJob(e.target.value)}>
          <option value="">Something not on the board</option>
          {jobs.map((j) => <option key={j.id} value={j.id}>{partOf(j.id)?.name ?? 'A deleted part'} ({STATUS_LABEL[j.status]}, ×{j.quantity})</option>)}
        </select>
      </label>
      {!jobId && (
        <label className="field" htmlFor="cut-name">
          What was cut
          <input id="cut-name" className="input" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} placeholder="Test coupon" />
        </label>
      )}
      <p className="note">Measure from the corner with the orange dot. Sizes in inches: 1/4, 0.25 and 6.35 mm all work.</p>
      <div className="toolbar">
        <SizeField id="cut-x" label="Along (x)" value={x} onChange={setX} />
        <SizeField id="cut-y" label="Up (y)" value={y} onChange={setY} />
        <SizeField id="cut-length" label="Length along x" value={length} onChange={setLength} />
        <SizeField id="cut-width" label="Width along y" value={width} onChange={setWidth} />
      </div>
      <div className="toolbar">
        <label className="check"><input type="checkbox" checked={turned} onChange={(e) => turn(e.target.checked)} /> Turned a quarter turn</label>
        <label className="check"><input type="checkbox" checked={status === 'planned'} onChange={(e) => setStatus(e.target.checked ? 'planned' : 'cut')} /> Only planned, not cut yet</label>
      </div>
      <div className="toolbar">
        <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>{status === 'cut' ? 'Record cut' : 'Plan it'}</button>
        <button type="button" className="btn btn-sm" onClick={props.onDone}>Cancel</button>
      </div>
    </form>
  )
}

function SizeField(props: { id: string; label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="field" htmlFor={props.id} style={{ flex: '1 1 110px' }}>
      {props.label}
      <input id={props.id} className="input" inputMode="decimal" value={props.value} onChange={(e) => props.onChange(e.target.value)} placeholder="in" />
    </label>
  )
}

/** Add a sheet, or change one. Returns an error to show, or null when saved. */
function SheetForm(props: { title: string; initial: NewSheet; fixedStock?: boolean; onSave: (input: NewSheet) => Promise<string | null>; onCancel: () => void }) {
  const stocks = stockTable.useRows().filter((s) => s.kind === 'plate')
  const sheets = sheetsTable.useRows()
  const [input, setInput] = useState(props.initial)
  const [saving, setSaving] = useState(false)
  const set = (changes: Partial<NewSheet>) => setInput({ ...input, ...changes })

  function pickStock(id: string) {
    // A new stock: its next ID and full sheet size.
    const fresh = sheetForm(stocks.find((s) => s.id === id), sheets)
    set({ stock_id: id, label: fresh.label, length: fresh.length || input.length, width: fresh.width || input.width })
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    const error = await props.onSave(input)
    setSaving(false)
    if (error) toast(error)
  }

  return (
    <Panel title={props.title}>
      <form className="panel-body" onSubmit={save}>
        {!props.fixedStock && (
          <label className="field" htmlFor="sheet-stock">
            Stock
            <select id="sheet-stock" className="input" value={input.stock_id} onChange={(e) => pickStock(e.target.value)}>
              {stocks.length === 0 && <option value="">No plate stock yet: add it under Stock</option>}
              {stocks.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
        )}
        <label className="field" htmlFor="sheet-label">
          ID, to write on the sheet
          <input id="sheet-label" className="input mono" value={input.label} maxLength={20} onChange={(e) => set({ label: e.target.value.toUpperCase() })} placeholder="AL250-001" />
        </label>
        <div className="toolbar">
          <SizeField id="sheet-length" label="Length" value={input.length} onChange={(length) => set({ length })} />
          <SizeField id="sheet-width" label="Width" value={input.width} onChange={(width) => set({ width })} />
        </div>
        <label className="field" htmlFor="sheet-location">
          Where it is (optional)
          <input id="sheet-location" className="input" value={input.location} maxLength={100} onChange={(e) => set({ location: e.target.value })} placeholder="Rack A, slot 2" />
        </label>
        <label className="field" htmlFor="sheet-link">
          Onshape layout assembly (optional)
          <input id="sheet-link" className="input" type="url" value={input.onshape_url} onChange={(e) => set({ onshape_url: e.target.value })} placeholder="https://cad.onshape.com/documents/..." />
        </label>
        <label className="field" htmlFor="sheet-note">
          Note (optional)
          <input id="sheet-note" className="input" value={input.note} maxLength={300} onChange={(e) => set({ note: e.target.value })} />
        </label>
        <div className="toolbar">
          <button type="submit" className="btn btn-primary" disabled={saving}>Save</button>
          <button type="button" className="btn" onClick={props.onCancel}>Cancel</button>
        </div>
      </form>
    </Panel>
  )
}

/** Cut a leftover piece off a sheet and give it its own ID. Starts with the biggest clear piece. */
function RemnantForm(props: { sheet: Sheet; cuts: Cut[]; gap: number; onDone: (id: string | null) => void }) {
  const { sheet } = props
  const stock = stockTable.useRows().find((s) => s.id === sheet.stock_id)
  const clear = biggestClearPiece(sheet, props.cuts.map(boxOf), props.gap)
  const [input, setInput] = useState<NewSheet>({
    ...sheetForm(stock, sheetsTable.rows()),
    length: clear ? String(Math.floor(clear.length * 4) / 4) : '',
    width: clear ? String(Math.floor(clear.width * 4) / 4) : '',
    location: sheet.location ?? '',
  })
  const [restIsScrap, setRestIsScrap] = useState(true)
  const [saving, setSaving] = useState(false)
  const set = (changes: Partial<NewSheet>) => setInput({ ...input, ...changes })

  async function save(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    const result = await splitRemnant(sheet, input, restIsScrap)
    setSaving(false)
    if (!result.ok) {
      toast(result.error)
      return
    }
    toast(`Added ${result.value.label}. Write it on the piece.`)
    props.onDone(result.value.id)
  }

  return (
    <form className="panel-body" onSubmit={save} aria-label="Cut off a remnant" style={{ display: 'grid', gap: 10 }}>
      <strong>Cut off a remnant</strong>
      <span className="note">
        {clear
          ? `The biggest clear piece is about ${sizeText(clear.length, clear.width)}, from ${inches(clear.x)} along and ${inches(clear.y)} up. Measure what you cut off.`
          : 'There\'s no clear piece left. Mark the sheet scrap instead.'}
      </span>
      <label className="field" htmlFor="remnant-label">
        New ID, to write on the piece
        <input id="remnant-label" className="input mono" value={input.label} maxLength={20} onChange={(e) => set({ label: e.target.value.toUpperCase() })} />
      </label>
      <div className="toolbar">
        <SizeField id="remnant-length" label="Length" value={input.length} onChange={(length) => set({ length })} />
        <SizeField id="remnant-width" label="Width" value={input.width} onChange={(width) => set({ width })} />
      </div>
      <label className="field" htmlFor="remnant-location">
        Where it goes
        <input id="remnant-location" className="input" value={input.location} maxLength={100} onChange={(e) => set({ location: e.target.value })} placeholder="Remnant shelf" />
      </label>
      <label className="check"><input type="checkbox" checked={restIsScrap} onChange={(e) => setRestIsScrap(e.target.checked)} /> The rest of {sheet.label} is scrap</label>
      <div className="toolbar">
        <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>Add remnant</button>
        <button type="button" className="btn btn-sm" onClick={() => props.onDone(null)}>Cancel</button>
      </div>
    </form>
  )
}
