// The team page's Auto paths panel (#205): every auto path scouted for the
// team at this event, drawn faintly on top of each other. Paths are saved in
// the blue view (see AutoPath in data.ts), so red and blue matches line up.
// Tap a match to pick its path out. Hidden when the team has no paths.
import { useState } from 'react'
import { Panel } from '../../core/ui'
import { useTeamAutoPaths, type TeamAutoPath } from './data'
import { FieldPicture, MarksToggle } from './FieldDrawing'

export default function TeamAutoPaths(props: { team: number }) {
  const paths = useTeamAutoPaths(props.team)
  return <AutoPathsPanel paths={paths} />
}

/** The panel itself, drawn from the paths, so tests can use made-up ones. */
export function AutoPathsPanel(props: { paths: TeamAutoPath[] }) {
  const [chosen, setChosen] = useState<string | null>(null)
  const [showMarks, setShowMarks] = useState(true)
  if (props.paths.length === 0) return null
  const picked = props.paths.find((p) => p.id === chosen)
  return (
    <Panel title="Auto paths" aside={<span className="note">{`${props.paths.length} ${props.paths.length === 1 ? 'match' : 'matches'}`}</span>}>
      <div className="panel-body">
        <p className="note" style={{ margin: 0 }}>
          Every match's auto, as if the robot were on blue, with its own driver station on the left. Tap a match to pick it out.
        </p>
        <FieldPicture
          label={picked ? `Auto path in qualification match ${picked.match}` : 'Every auto path scouted for this team'}
          paths={props.paths.map((p) => ({ id: p.id, path: p.path, look: !picked ? 'normal' : p.id === picked.id ? 'strong' : 'faint' }))}
          redLeft={false}
          showMarks={showMarks}
        />
        <div className="toolbar" role="group" aria-label="Matches">
          {props.paths.map((p) => (
            <button key={p.id} type="button" className={p.id === chosen ? 'btn btn-primary' : 'btn'} style={{ minHeight: 44 }} aria-pressed={p.id === chosen} onClick={() => setChosen(p.id === chosen ? null : p.id)}>
              {`Q${p.match}${p.path.didnt_move ? " · didn't move" : ''}`}
            </button>
          ))}
        </div>
        <div className="toolbar">
          <MarksToggle show={showMarks} onChange={setShowMarks} />
        </div>
      </div>
    </Panel>
  )
}
