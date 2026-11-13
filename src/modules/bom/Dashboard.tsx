/**
 * The BOM's dashboard (#23): how close the robot, and each of its systems,
 * is to being built. The numbers come from stats.ts.
 *
 * It reads rows through the same hooks as the rest of the page, so it
 * updates straight away when anyone marks a stage done or Inventory changes.
 */
import { plural } from '../../core/format'
import { Bar, Panel, Pill } from '../../core/ui'
import { useItems } from '../inventory/data'
import { useRobotParts, useSteps, useSystems, type BomSystem, type Robot, type Station } from './data'
import { percent, robotStats, waitingText, type BuildStats } from './stats'

/**
 * The robot's total at the top, then a card for each system. Tapping a
 * "waiting for" count calls `onOpen` with that system and station, so the
 * page can show those parts.
 */
export function Dashboard(props: { robot: Robot; onOpen: (system: BomSystem, station: Station) => void }) {
  const { robot } = props
  const systems = useSystems(robot.id)
  const { total, systems: cards } = robotStats(systems, useRobotParts(robot.id), useSteps(), useItems())

  if (systems.length === 0) {
    return (
      <Panel title="Dashboard">
        <p className="panel-body muted">No systems in {robot.name} yet. Add one above, and how far along it is shows here.</p>
      </Panel>
    )
  }

  return (
    <>
      <Panel title="Whole robot" aside={<DoneMark stats={total} />}>
        <div className="panel-body">
          <Built stats={total} label={robot.name} />
          <Counts stats={total} />
          {total.waiting.length > 0 && <p className="note">{total.waiting.map(waitingText).join(' · ')}</p>}
          <p className="note">
            Each part counts the same: a Custom part by how many are through every stage, and a COTS part by how many of what the robot needs are on the shelf.
          </p>
        </div>
      </Panel>

      {/* A card for each system. On a phone they're one column; wider, they sit side by side. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 280px), 1fr))', gap: 14 }}>
        {cards.map(({ system, stats }) => (
          <Panel key={system.id} title={system.name} aside={stats.parts > 0 ? <DoneMark stats={stats} /> : undefined}>
            <div className="panel-body">
              {stats.parts === 0 ? (
                <p className="muted">No parts in {system.name} yet.</p>
              ) : (
                <>
                  <Built stats={stats} label={system.name} />
                  <Counts stats={stats} />
                  {stats.waiting.length > 0 && (
                    <div className="toolbar" style={{ gap: 6 }}>
                      {stats.waiting.map((w) => (
                        <button key={w.name} type="button" className="btn btn-sm" onClick={() => props.onOpen(system, w.station)}>
                          {waitingText(w)}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </Panel>
        ))}
      </div>
    </>
  )
}

/** A "Done" mark once everything is done. */
function DoneMark(props: { stats: BuildStats }) {
  return percent(props.stats.progress) === 100 ? <Pill tone="ok">Done</Pill> : null
}

/** "62% built" and a progress bar. `label` names what it's for, for screen readers. */
function Built(props: { stats: BuildStats; label: string }) {
  const built = percent(props.stats.progress)
  return (
    <div style={{ display: 'grid', gap: 4 }}>
      <strong>{built}% built</strong>
      {/* The bar gets the same rounded-down percent, so it never says more than the words do. */}
      <Bar value={built / 100} label={`${props.label} built`} />
    </div>
  )
}

/** Like "Custom: 1 of 3 done · COTS: 2 of 3 on the shelf", and how many Custom parts have no stages yet. */
function Counts(props: { stats: BuildStats }) {
  const { stats } = props
  return (
    <p className="note">
      {plural(stats.parts, 'part', 'parts')}
      {stats.custom > 0 && ` · Custom: ${stats.customDone} of ${stats.custom} done (${percent(stats.customProgress)}%)`}
      {stats.cots > 0 && ` · COTS: ${stats.cotsCovered} of ${stats.cots} on the shelf (${percent(stats.cotsProgress)}%)`}
      {stats.noStages > 0 && ` · ${stats.noStages} Custom with no stages yet`}
    </p>
  )
}
