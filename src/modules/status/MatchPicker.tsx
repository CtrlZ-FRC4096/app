import { Panel, Pill } from '../../core/ui'
import { useScheduleStatus } from '../scouting/data'
import { PRACTICE_KEY, matchProgress, matchTime, progressText, usePitChecklist, usePitChecks, type PitMatch } from './data'

// Our matches still to play, from the event schedule (The Blue Alliance, with
// Match 13's predictions), and the practice round. Each says Ready or how
// many items are left. Tapping one shows the checklist for it.
export function MatchPicker({ matches, chosen, onChoose }: { matches: PitMatch[]; chosen: PitMatch; onChoose: (key: string) => void }) {
  const items = usePitChecklist()
  const checks = usePitChecks()
  const status = useScheduleStatus()
  const noSchedule = matches.length === 1 && matches[0].key === PRACTICE_KEY

  return (
    <Panel title="Our matches" aside={status.loading ? <span className="note">Updating…</span> : undefined}>
      {noSchedule && (
        <p className="panel-body muted" style={{ margin: 0 }}>
          No matches of ours to come in the schedule yet{status.problem ? ` (${status.problem})` : ''}. Use the practice round until there are.
        </p>
      )}
      <div className="pit-matches" role="group" aria-label="Choose a match">
        {matches.map((match) => {
          const progress = matchProgress(items, checks, match.key)
          return (
            <button key={match.key} type="button" className="pit-match" aria-pressed={match.key === chosen.key} onClick={() => onChoose(match.key)}>
              <span className="pit-match-name">
                <strong>{match.label}</strong>
                {match.alliance && <Pill tone={match.alliance === 'Red' ? 'crit' : 'info'}>{match.alliance}</Pill>}
              </span>
              <span className="note">
                {[match.time !== null && matchTime(match.time), match.prediction && `Match 13: ${match.prediction}`].filter(Boolean).join(' · ') || ' '}
              </span>
              <Pill tone={progress.ready ? 'ok' : progress.total ? 'warn' : 'plain'}>{progressText(progress)}</Pill>
            </button>
          )
        })}
      </div>
    </Panel>
  )
}
