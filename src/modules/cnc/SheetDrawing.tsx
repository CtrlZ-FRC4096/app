import type { KeyboardEvent } from 'react'
import { STATUS_LABEL } from './data'
import { svgPath, type Box, type Loops } from './geometry'

/** Something drawn on a sheet: a cut, a planned cut, or a spot found for a waiting part. */
export interface Drawn {
  id: string
  name: string
  box: Box
  outline: Loops | null
  kind: 'cut' | 'planned' | 'preview'
}

const LOOK = {
  // Cut out: the sheet's gone there, so it shows the page behind.
  cut: { fill: 'var(--bg)', stroke: 'var(--muted)', dash: undefined },
  planned: { fill: 'var(--surface)', stroke: 'var(--blue)', dash: '6 4' },
  preview: { fill: 'var(--warn-bg)', stroke: 'var(--orange)', dash: '3 3' },
}

/**
 * A sheet drawn to scale, long side across, with the corner at the
 * layout's origin bottom left. Tap a cut to choose it.
 */
export function SheetDrawing(props: {
  length: number
  width: number
  items: Drawn[]
  selected: string | null
  onSelect: (id: string | null) => void
  label: string
}) {
  const { length: L, width: W } = props
  // Room round the edge for the origin mark, in inches.
  const pad = Math.max(L, W) * 0.02

  function keys(event: KeyboardEvent, id: string) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      props.onSelect(props.selected === id ? null : id)
    }
  }

  return (
    <svg
      viewBox={`${-pad} ${-pad} ${L + 2 * pad} ${W + 2 * pad}`}
      role="group"
      aria-label={props.label}
      style={{ width: '100%', maxWidth: 820, height: 'auto', display: 'block', touchAction: 'manipulation' }}
    >
      <rect x={0} y={0} width={L} height={W} fill="var(--blue-soft)" stroke="var(--line)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" onClick={() => props.onSelect(null)} />
      {props.items.map((item) => {
        const look = LOOK[item.kind]
        const chosen = props.selected === item.id
        const { x, y, length, width } = item.box
        // Names inside, if there's room: under a third of the box's height, at most 1.3 in tall.
        const size = Math.min(width * 0.3, 1.3, (length / Math.max(item.name.length, 1)) * 1.7)
        const outline = item.outline ? svgPath(item.outline, x, y, W) : ''
        return (
          <g
            key={item.id}
            role={item.kind === 'preview' ? undefined : 'button'}
            tabIndex={item.kind === 'preview' ? undefined : 0}
            aria-label={item.kind === 'preview' ? undefined : `${item.name}, ${item.kind === 'cut' ? STATUS_LABEL.cut : 'planned'}`}
            aria-pressed={item.kind === 'preview' ? undefined : chosen}
            style={{ cursor: item.kind === 'preview' ? undefined : 'pointer', outline: 'none' }}
            onClick={item.kind === 'preview' ? undefined : (e) => { e.stopPropagation(); props.onSelect(chosen ? null : item.id) }}
            onKeyDown={item.kind === 'preview' ? undefined : (e) => keys(e, item.id)}
          >
            {/* The box, so the whole area can be tapped, under the outline if there is one. */}
            <rect
              x={x}
              y={W - y - width}
              width={length}
              height={width}
              fill={outline ? 'transparent' : look.fill}
              stroke={outline && !chosen ? 'none' : chosen ? 'var(--orange)' : look.stroke}
              strokeWidth={chosen ? 3 : 1.5}
              strokeDasharray={outline ? '2 3' : look.dash}
              vectorEffect="non-scaling-stroke"
            />
            {outline && (
              <path d={outline} fillRule="evenodd" fill={look.fill} stroke={chosen ? 'var(--orange)' : look.stroke} strokeWidth={chosen ? 3 : 1.5} strokeDasharray={look.dash} vectorEffect="non-scaling-stroke" />
            )}
            {size >= 0.4 && (
              <text
                x={x + length / 2}
                y={W - y - width / 2}
                fontSize={size}
                textAnchor="middle"
                dominantBaseline="central"
                fill="var(--ink)"
                // A halo the colour of the page, so the name reads over the part's lines.
                stroke="var(--surface)"
                strokeWidth={size * 0.3}
                paintOrder="stroke"
                style={{ pointerEvents: 'none', userSelect: 'none' }}
              >
                {item.name}
              </text>
            )}
          </g>
        )
      })}
      {/* The corner at the layout's origin. */}
      <circle cx={0} cy={W} r={pad * 0.6} fill="var(--orange)" />
    </svg>
  )
}
