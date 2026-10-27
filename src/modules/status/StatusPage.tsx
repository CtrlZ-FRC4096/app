import { useState } from 'react'
import { PageHead, Panel } from '../../core/ui'
import { advanceStage, STAGES, SUBSYSTEMS, type Stage } from './data'
import { PitChecklist } from './PitChecklist'
import './status.css'

export default function StatusPage() {
  const [subsystems, setSubsystems] = useState(SUBSYSTEMS)

  function advance(id: string, stage: Stage) {
    setSubsystems((current) => current.map((subsystem) => (
      subsystem.id === id ? advanceStage(subsystem, stage) : subsystem
    )))
  }

  return (
    <>
      <PageHead eyebrow="Team 4096" title="Robot status">
        Track each subsystem from design through testing, and work through the pit checklist at events.
      </PageHead>
      <Panel title="Subsystem progress" className="status-panel">
        <p className="panel-body" id="status-instructions">
          Click a cell to cycle: Not started → In progress → Done → Not started. Changes to the grid reset when you leave or reload this page.
          On a phone, swipe across the grid to see every stage.
        </p>
        <div className="table-wrap status-scroll" role="region" aria-label="Subsystem progress grid" tabIndex={0}>
          <table className="status-grid" aria-label="Robot subsystem status" aria-describedby="status-instructions">
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
                        className="btn status-cell"
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
      <PitChecklist />
    </>
  )
}
