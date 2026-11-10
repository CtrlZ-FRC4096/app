import { useState } from 'react'
import { PageHead, Panel } from '../../core/ui'
import { advanceStage, STAGES, SUBSYSTEMS, type Stage } from './data'
import './progress.css'

/** The subsystem progress grid. Moved from Robot status (#65, step 1). */
export default function ProgressPage() {
  const [subsystems, setSubsystems] = useState(SUBSYSTEMS)

  function advance(id: string, stage: Stage) {
    setSubsystems((current) => current.map((subsystem) => (
      subsystem.id === id ? advanceStage(subsystem, stage) : subsystem
    )))
  }

  return (
    <>
      <PageHead title="Build progress">
        Where each subsystem stands: designed, built, wired, programmed and tested.
      </PageHead>
      <Panel title="Subsystem progress" className="progress-panel">
        <p className="panel-body" id="progress-instructions">
          Click a cell to cycle: Not started → In progress → Done → Not started. Changes to the grid reset when you leave or reload this page.
          On a phone, swipe across the grid to see every stage.
        </p>
        <div className="table-wrap progress-scroll" role="region" aria-label="Subsystem progress grid" tabIndex={0}>
          <table className="progress-grid" aria-label="Robot subsystem progress" aria-describedby="progress-instructions">
            <thead>
              <tr>
                <th scope="col">Subsystem</th>
                {STAGES.map((stage) => <th key={stage} scope="col">{stage}</th>)}
              </tr>
            </thead>
            <tbody>
              {subsystems.map((subsystem) => (
                <tr key={subsystem.id}>
                  <th scope="row">{subsystem.name}</th>
                  {STAGES.map((stage) => (
                    <td key={stage}>
                      <button
                        type="button"
                        className="btn progress-cell"
                        data-state={subsystem.stages[stage]}
                        aria-label={`${subsystem.name}, ${stage}: ${subsystem.stages[stage]}. Advance status`}
                        onClick={() => advance(subsystem.id, stage)}
                      >
                        {subsystem.stages[stage]}
                      </button>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  )
}
