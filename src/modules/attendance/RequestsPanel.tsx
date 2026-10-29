import { useMemberNames } from '../../core/members'
import { toast } from '../../core/toast'
import { Panel, Pill } from '../../core/ui'
import { checksOn, decideRequest, peopleTable, useAttendance, useDecidedRequests, useWaitingRequests, type AttendanceRequest } from './data'
import { requestTimes, STATUS_LABEL, STATUS_TONE } from './requests'
import { dayLabel, teamClock } from './time'

/**
 * Mentors and admins: requests for missing hours, at the bottom of the tab.
 * Approving adds the times as check-ins and check-outs, so the person's
 * hours and points update straight away.
 */
export function RequestsPanel() {
  const waiting = useWaitingRequests()
  const decided = useDecidedRequests()
  const people = peopleTable.useRows()
  const { checks } = useAttendance()
  const nameOf = useMemberNames()
  const personName = (request: AttendanceRequest) => people.find((p) => p.id === request.person_id)?.name ?? 'Someone'

  async function decide(request: AttendanceRequest, approve: boolean) {
    const result = await decideRequest(request, approve)
    toast(result.ok ? (approve ? `Approved. ${personName(request)}'s hours are updated.` : 'Declined.') : result.error)
  }

  return (
    <Panel title="Requests for missing hours" aside={<span className="note">{waiting.length ? `${waiting.length} waiting` : 'None waiting'}</span>}>
      {waiting.length === 0 ? (
        <p className="panel-body muted">Nothing to approve. When someone asks for hours Jibble missed, it shows here.</p>
      ) : (
        <div className="row-list">
          {waiting.map((request) => {
            const already = checksOn(checks, request.person_id, request.day).filter((c) => !c.ignored)
            return (
              <div key={request.id} style={{ flexWrap: 'wrap' }}>
                <span style={{ minWidth: 0, flex: '1 1 260px', overflowWrap: 'anywhere' }}>
                  <strong>{personName(request)}</strong> · {dayLabel(request.day)} · {requestTimes(request)}
                  <br />
                  <span className="note">“{request.note}”</span>
                  <br />
                  <span className="note">
                    Jibble has: {already.length ? already.map((c) => `${c.direction} ${teamClock(c.at)}`).join(', ') : 'nothing that day'}
                  </span>
                </span>
                <span className="toolbar" style={{ marginLeft: 'auto' }}>
                  <button type="button" className="btn btn-sm btn-primary" onClick={() => void decide(request, true)}>Approve</button>
                  <button type="button" className="btn btn-sm" onClick={() => void decide(request, false)}>Decline</button>
                </span>
              </div>
            )
          })}
        </div>
      )}
      {decided.length > 0 && (
        <>
          <h3 className="panel-body" style={{ paddingBottom: 0 }}>Decided lately</h3>
          <div className="row-list">
            {decided.map((request) => (
              <div key={request.id}>
                <Pill tone={STATUS_TONE[request.status]}>{STATUS_LABEL[request.status]}</Pill>
                <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                  {personName(request)} · {dayLabel(request.day)} · {requestTimes(request)}
                  <span className="note"> · by {nameOf(request.decided_by)}</span>
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </Panel>
  )
}
