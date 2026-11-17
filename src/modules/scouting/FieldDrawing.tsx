// The field picture for auto paths (#205). FieldPicture only shows paths
// (the team page uses it), and FieldDrawing lets the scout draw one on the
// match form. The field's size and landmarks come from FIELD in season.ts,
// and the rules (turning the field, limits, Undo) are in data.ts.
import { useState, type PointerEvent, type ReactNode } from 'react'
import { Pick } from '../../core/ui'
import {
  allianceOf, drawnSummary, fieldLandmarks, pointerPoint, redOnLeft, setFieldFlipped, strokePath, useFieldFlipped, usePosition, viewPoint,
  type AutoPath, type PathDraft, type PathEdit, type PathPoint, type PlacedLandmark,
} from './data'
import { AUTO_MARKS, FIELD } from './season'

const { length: L, width: W } = FIELD

/** The colours for each alliance's things on the field. */
const ALLIANCE_INK = { red: 'var(--red-alliance)', blue: 'var(--blue-alliance)' }
const ALLIANCE_FILL = { red: 'var(--red-alliance-bg)', blue: 'var(--blue-alliance-bg)' }

/** Buttons under the field: big enough to tap. */
const TAP = { minHeight: 44 }

/** One path to show, and how strongly. */
export interface ShownPath {
  id: string
  path: AutoPath
  /** 'faint' for one of many, 'strong' for the one picked out. */
  look?: 'normal' | 'faint' | 'strong'
}

const PATH_OPACITY = { normal: 0.55, faint: 0.15, strong: 1 }

/**
 * The field with paths drawn on it, landscape, filling the width. `redLeft`
 * turns the field so red's driver station is on the left. `toScreen` turns a
 * saved spot into where it shows (see viewPoint() in data.ts). Pointer
 * handlers go on the picture itself, so only the picture stops the page
 * scrolling while drawing.
 */
export function FieldPicture(props: {
  label: string
  paths: ShownPath[]
  redLeft: boolean
  showMarks: boolean
  toScreen?: (point: PathPoint) => PathPoint
  drawable?: boolean
  onPointerDown?: (event: PointerEvent<SVGSVGElement>) => void
  onPointerMove?: (event: PointerEvent<SVGSVGElement>) => void
  onPointerUp?: (event: PointerEvent<SVGSVGElement>) => void
}) {
  const toScreen = props.toScreen ?? ((p: PathPoint) => p)
  const left = props.redLeft ? 'red' : 'blue'
  const right = props.redLeft ? 'blue' : 'red'
  return (
    <svg
      viewBox={`0 0 ${L} ${W}`}
      role="img"
      aria-label={props.label}
      style={{ width: '100%', maxWidth: 720, height: 'auto', display: 'block', touchAction: props.drawable ? 'none' : 'manipulation', cursor: props.drawable ? 'crosshair' : undefined, userSelect: 'none' }}
      onPointerDown={props.onPointerDown}
      onPointerMove={props.onPointerMove}
      onPointerUp={props.onPointerUp}
      onPointerCancel={props.onPointerUp}
      onLostPointerCapture={props.onPointerUp}
    >
      <rect x={0} y={0} width={L} height={W} fill="var(--surface-2)" stroke="var(--line)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      {/* The driver station walls, in their alliance's colour. */}
      <rect x={0} y={0} width={0.12} height={W} fill={ALLIANCE_INK[left]} />
      <rect x={L - 0.12} y={0} width={0.12} height={W} fill={ALLIANCE_INK[right]} />
      {fieldLandmarks(props.redLeft).map((l, i) => <LandmarkShape key={i} landmark={l} />)}
      {props.paths.map((shown) => <PathShape key={shown.id} shown={shown} toScreen={toScreen} showMarks={props.showMarks} />)}
    </svg>
  )
}

function LandmarkShape({ landmark: l }: { landmark: PlacedLandmark }) {
  const ink = l.alliance ? ALLIANCE_INK[l.alliance] : 'var(--muted)'
  const thin = { strokeWidth: 1.5, vectorEffect: 'non-scaling-stroke' as const }
  let shape: ReactNode
  if (l.look === 'line') {
    shape = <line x1={l.x} y1={l.y} x2={l.x + l.width} y2={l.y + l.height} stroke={ink} strokeDasharray="4 4" {...thin} />
  } else {
    const fill = l.alliance ? ALLIANCE_FILL[l.alliance] : 'var(--surface)'
    shape = <rect x={l.x} y={l.y} width={l.width} height={l.height} fill={fill} fillOpacity={l.look === 'floor' ? 0.6 : 1} stroke={ink} strokeDasharray={l.look === 'floor' ? '3 3' : undefined} {...thin} />
  }
  if (!l.label) return shape
  // Words go beside things against a wall, so they aren't cut off.
  const atLeft = l.x < 0.01
  const atRight = l.x + l.width > L - 0.01
  const x = atLeft ? l.x + l.width + 0.08 : atRight ? l.x - 0.08 : l.x + l.width / 2
  return (
    <g>
      {shape}
      <text x={x} y={l.y + l.height / 2} fontSize={0.32} fill="var(--muted)" textAnchor={atLeft ? 'start' : atRight ? 'end' : 'middle'} dominantBaseline="central">{l.label}</text>
    </g>
  )
}

/** One path: its lines, a dot where it started, a ring where it ended, and its marks. */
function PathShape(props: { shown: ShownPath; toScreen: (point: PathPoint) => PathPoint; showMarks: boolean }) {
  const { path, look = 'normal' } = props.shown
  const lines = path.strokes.map((line) => line.map(props.toScreen))
  const first = lines[0]?.[0]
  const lastLine = lines[lines.length - 1]
  const last = lastLine?.[lastLine.length - 1]
  const at = ([x, y]: PathPoint) => ({ cx: x * L, cy: y * W })
  return (
    <g opacity={PATH_OPACITY[look]}>
      {lines.map((line, i) => (
        <path key={i} d={strokePath(line)} fill="none" stroke="var(--orange)" strokeWidth={look === 'strong' ? 4 : 3} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      ))}
      {first && <circle {...at(first)} r={0.2} fill="var(--orange)" />}
      {last && <circle {...at(last)} r={0.24} fill="var(--surface)" stroke="var(--orange)" strokeWidth={3} vectorEffect="non-scaling-stroke" />}
      {props.showMarks && path.marks.map((mark, i) => {
        const spot = props.toScreen([mark.x, mark.y])
        const letter = AUTO_MARKS.find((m) => m.key === mark.type)?.letter ?? '?'
        return (
          <g key={i}>
            <circle {...at(spot)} r={0.3} fill="var(--ink)" />
            <text x={spot[0] * L} y={spot[1] * W} fontSize={0.36} fontWeight={700} fill="var(--bg)" textAnchor="middle" dominantBaseline="central">{letter}</text>
          </g>
        )
      })}
    </g>
  )
}

/** What a tap on the field does: draw a line, or place one of AUTO_MARKS. */
const DRAW = 'Draw path'

/**
 * The match form's auto path (#205): the scout traces where the robot drove
 * with a finger, places marks, and can Undo, Clear, say it Didn't move, and
 * Flip field to see it from where they sit. The form keeps `draft`; every
 * change goes through editPath() in data.ts.
 */
export default function FieldDrawing(props: { draft: PathDraft; onEdit: (edit: PathEdit) => void }) {
  const { draft, onEdit } = props
  const alliance = allianceOf(usePosition())
  const flipped = useFieldFlipped()
  const [tool, setTool] = useState(DRAW)
  const [showMarks, setShowMarks] = useState(true)
  const view = alliance ? { alliance, flipped } : null
  const redLeft = view ? redOnLeft(view) : false

  // Where the pointer is, saved in the blue view.
  function spot(event: PointerEvent<SVGSVGElement>): PathPoint | null {
    if (!view) return null
    return viewPoint(pointerPoint(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect()), view)
  }

  function down(event: PointerEvent<SVGSVGElement>) {
    const at = spot(event)
    if (!at || !event.isPrimary) return
    const mark = AUTO_MARKS.find((m) => m.label === tool)
    if (mark) {
      onEdit({ kind: 'mark', type: mark.key, at })
      return
    }
    // Keep getting moves even if the finger slides off the picture.
    event.currentTarget.setPointerCapture?.(event.pointerId)
    onEdit({ kind: 'start', at })
  }

  // Only the first finger draws, so a second one resting on the screen doesn't add to the line.
  function move(event: PointerEvent<SVGSVGElement>) {
    const at = event.isPrimary ? spot(event) : null
    if (at) onEdit({ kind: 'move', at })
  }

  function up(event: PointerEvent<SVGSVGElement>) {
    const at = event.isPrimary ? spot(event) : null
    if (at) onEdit({ kind: 'end', at })
  }

  const path = draft.path
  const nothing = path.strokes.length === 0 && path.marks.length === 0 && !path.didnt_move
  return (
    <div className="field" style={{ gap: 8 }}>
      What did it do in auto? Trace where it drove with your finger (required)
      {alliance ? (
        <span className="note">{`Its own driver station (${alliance === 'red' ? 'red' : 'blue'}) is on the ${redLeft === (alliance === 'red') ? 'left' : 'right'}. Tap Flip field if the field looks the other way round from your seat.`}</span>
      ) : (
        <span className="note" style={{ color: 'var(--warn)' }}>Pick your position above (Red 1 to Blue 3) first, so the field faces the right way.</span>
      )}
      <Pick label="What a tap does" options={[DRAW, ...AUTO_MARKS.map((m) => m.label)]} value={tool} onChange={setTool} />
      <FieldPicture
        label="The field, to draw the robot's auto path on"
        paths={[{ id: 'drawing', path }]}
        redLeft={redLeft}
        showMarks={showMarks}
        toScreen={view ? (p) => viewPoint(p, view) : undefined}
        drawable={Boolean(view)}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
      />
      <span className="note" aria-live="polite" style={{ color: 'var(--ink)' }}>{drawnSummary(path)}</span>
      <div className="toolbar">
        <button type="button" className="btn" style={TAP} disabled={draft.earlier.length === 0} onClick={() => onEdit({ kind: 'undo' })}>Undo</button>
        <button type="button" className="btn" style={TAP} disabled={nothing} onClick={() => onEdit({ kind: 'clear' })}>Clear</button>
        <button type="button" className={path.didnt_move ? 'btn btn-primary' : 'btn'} style={TAP} aria-pressed={path.didnt_move} onClick={() => onEdit({ kind: 'didntMove' })}>Didn't move</button>
        <button type="button" className="btn" style={TAP} aria-pressed={flipped} disabled={!view} onClick={() => setFieldFlipped(!flipped)}>Flip field</button>
        <MarksToggle show={showMarks} onChange={setShowMarks} />
      </div>
    </div>
  )
}

/** Show or hide the marks, with what each letter means. */
export function MarksToggle(props: { show: boolean; onChange: (show: boolean) => void }) {
  return (
    <>
      <button type="button" className="btn" style={TAP} aria-pressed={props.show} onClick={() => props.onChange(!props.show)}>
        {props.show ? 'Hide marks' : 'Show marks'}
      </button>
      {props.show && <span className="note">{AUTO_MARKS.map((m) => `${m.letter}: ${m.label}`).join(' · ')}</span>}
    </>
  )
}
