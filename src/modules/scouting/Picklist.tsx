import { href } from '../../core/router'
import { toast } from '../../core/toast'
import { PageHead, Panel, Pill, Stepper } from '../../core/ui'
import {
  MAX_WEIGHT, allWeightsZero, picklistCsv, picklistParts, resetWeights, savedWhen, setWeight, useRankedPicklist, weightOf,
  type PicklistLine, type PicklistPart, type Weights,
} from './data'

// Every team at the event, ranked by a mix of our scouting and Match 13's
// numbers, at #/scouting/picklist. The ranking is rankTeams() in data.ts;
// this page only shows it. The weights are saved on this phone, so each
// scout can try their own without changing anyone else's list.
export default function Picklist() {
  const { ranked, weights, ratings } = useRankedPicklist()
  const parts = picklistParts()
  const noWeights = allWeightsZero(weights)

  async function copy() {
    try {
      await navigator.clipboard.writeText(picklistCsv(ranked, parts))
      toast('Copied. Paste it into a spreadsheet.')
    } catch {
      toast("Couldn't copy the list. Check the browser is allowed to use the clipboard, then try again.")
    }
  }

  // When the Match 13 numbers are from, and whether they could be loaded.
  let ratingsNote: string
  if (ratings.loadedAt === null) {
    ratingsNote = ratings.error
      ? `Couldn't reach Match 13: ${ratings.error} The list uses our scouting only until it can.`
      : 'Getting the Match 13 numbers…'
  } else {
    const when = ratings.ratings.length === 0
      ? "Match 13 hasn't rated any teams at this event yet."
      : `Match 13 numbers from ${savedWhen(ratings.loadedAt)}, saved on this phone.`
    ratingsNote = ratings.error ? `Couldn't reach Match 13: ${ratings.error} ${when}` : when
  }

  return (
    <>
      <PageHead title="Picklist">
        Every team at the event, best first, from our scouting and Match 13. Change the weights to choose what matters most.
      </PageHead>
      <div className="toolbar" style={{ marginBottom: 12 }}>
        <span className="note" role="status">{ratingsNote}</span>
        <button type="button" className="btn" style={{ minHeight: 44 }} disabled={ratings.loading} onClick={ratings.refresh}>
          {ratings.loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>
      <div className="stack">
        <WeightsPanel parts={parts} weights={weights} />
        <Panel
          title="Ranked teams"
          aside={ranked.length > 0 && <button type="button" className="btn" style={{ minHeight: 44 }} onClick={() => void copy()}>Copy as CSV</button>}
        >
          {ranked.length === 0 ? (
            <p className="panel-body muted">No teams yet. Teams show up here once we scout them or Match 13 rates them.</p>
          ) : noWeights ? (
            <p className="panel-body muted">Set at least one weight above 0 to rank teams.</p>
          ) : (
            <div>
              {ranked.map((line) => <Line key={line.team} line={line} parts={parts} weights={weights} />)}
            </div>
          )}
        </Panel>
      </div>
    </>
  )
}

// How much each part counts, from 0 (not at all) to 5. Folded away to start
// with, so on a phone the list comes first.
function WeightsPanel(props: { parts: PicklistPart[]; weights: Weights }) {
  return (
    <details className="panel">
      <summary style={{ minHeight: 44, padding: '12px 16px', cursor: 'pointer', fontWeight: 600 }}>Weights</summary>
      <div className="row-list" style={{ borderTop: '1px solid var(--line)' }}>
        {props.parts.map((part) => (
          <div key={part.key} style={{ flexWrap: 'wrap' }}>
            <label htmlFor={`weight-${part.key}`}>
              {part.label}
              {part.lowerIsBetter && <span className="note"> (fewer is better)</span>}
            </label>
            <span style={{ marginLeft: 'auto' }}>
              <Stepper id={`weight-${part.key}`} label={`Weight for ${part.label}`} value={weightOf(props.weights, part.key)} onChange={(n) => setWeight(part.key, n)} />
            </span>
          </div>
        ))}
        <div>
          <span className="note">0 leaves a part out. {MAX_WEIGHT} counts it most.</span>
          <button type="button" className="btn" style={{ marginLeft: 'auto', minHeight: 44 }} onClick={resetWeights}>Reset weights</button>
        </div>
      </div>
    </details>
  )
}

// One team: "1. Team 4096  82", the numbers behind the score, and what's
// missing. The whole card opens the team's page.
function Line(props: { line: PicklistLine; parts: PicklistPart[]; weights: Weights }) {
  const { line } = props
  const numbers = props.parts
    .filter((part) => weightOf(props.weights, part.key) > 0)
    .map((part) => {
      const value = line.parts[part.key]
      return `${part.label} ${value == null ? '–' : Math.round(value * 10) / 10}`
    })
  return (
    <a
      href={href('scouting', 'team', String(line.team))}
      style={{ display: 'grid', gap: 4, padding: '10px 16px', borderBottom: '1px solid var(--line)', color: 'inherit', textDecoration: 'none' }}
    >
      <span style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <strong style={{ fontSize: 18 }}>{`${line.rank}. Team ${line.team}`}</strong>
        <strong className="tnum" style={{ marginLeft: 'auto', fontSize: 22 }}>{line.score === null ? '–' : Math.round(line.score)}</strong>
      </span>
      <span className="note" style={{ overflowWrap: 'anywhere' }}>
        {[...numbers, `${line.matches} ${line.matches === 1 ? 'match' : 'matches'}`].join(' · ')}
      </span>
      {(line.matches === 0 || !line.rated) && (
        <span style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {line.matches === 0 && <Pill tone="plain">No scouting yet</Pill>}
          {!line.rated && <Pill tone="plain">No Match 13 rating yet</Pill>}
        </span>
      )}
    </a>
  )
}
