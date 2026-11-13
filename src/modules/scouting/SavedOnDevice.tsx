import type { ReactNode } from 'react'
import { shortDate } from '../../core/format'
import { toast } from '../../core/toast'
import { Panel, Pill } from '../../core/ui'
import { syncEntries, useSyncStatus } from './data'

/** One entry in the list: what to call it, when it was saved, and whether it's reached the team. */
export interface SavedRow {
  id: string
  /** Text, or text with a link in it (like a team linked to its team page). */
  label: ReactNode
  created_at: string
  synced: boolean
}

/**
 * The entries saved on this phone, newest first, each Waiting or Synced.
 * Waiting entries send by themselves once there's a connection; this says
 * why any haven't yet, and has a Send now button for the impatient. Used by
 * the match form and the pit form.
 */
export default function SavedOnDevice(props: { rows: SavedRow[]; emptyText: string; title?: string }) {
  const sync = useSyncStatus()
  const waiting = props.rows.filter((row) => !row.synced).length

  async function sendNow() {
    const result = await syncEntries()
    if (!result.ok) toast(result.error)
    else toast(result.value === 0 ? 'Everything on this phone is sent.' : `Sent ${result.value === 1 ? '1 entry' : `${result.value} entries`} to the team.`)
  }

  return (
    // Space between the form and the list, so they don't run together.
    <div style={{ marginTop: 28 }}>
      <Panel
        title={props.title ?? 'Saved on this device'}
        aside={<span className="note">{waiting > 0 ? `${waiting} waiting` : props.rows.length > 0 ? 'All synced' : '0 saved'}</span>}
      >
        {waiting > 0 && (
          <div className="panel-body">
            <p className="note" style={{ margin: 0 }} aria-live="polite">
              {sync.sending
                ? 'Sending…'
                : sync.problem
                  ? `Not sent yet. ${sync.problem}`
                  : "Waiting entries send to the team by themselves when there's a connection."}
            </p>
            <div className="toolbar">
              <button type="button" className="btn" disabled={sync.sending} onClick={() => void sendNow()}>Send now</button>
            </div>
          </div>
        )}
        {props.rows.length === 0 ? (
          <p className="panel-body muted">{props.emptyText}</p>
        ) : (
          <div className="row-list">
            {props.rows.map((row) => (
              <div key={row.id}>
                <span>{row.label}<br /><span className="note">{shortDate(row.created_at)}</span></span>
                <span style={{ marginLeft: 'auto' }}>
                  {row.synced ? <Pill tone="ok">Synced</Pill> : <Pill tone="warn">Waiting</Pill>}
                </span>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  )
}
