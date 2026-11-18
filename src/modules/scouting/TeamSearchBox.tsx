import { useEffect, useState } from 'react'
import { loadEventTeams, searchTeams, useCurrentEvent, useSavedEventTeams, type TbaTeam } from './data'

export default function TeamSearchBox(props: { id: string; value: string; onChange: (value: string) => void; showSuggestions?: boolean }) {
  const event = useCurrentEvent().key
  const teams = useSavedEventTeams(event)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let active = true
    const load = () => {
      if (active) void loadEventTeams(event)
    }
    load()
    globalThis.addEventListener?.('online', load)
    return () => {
      active = false
      globalThis.removeEventListener?.('online', load)
    }
  }, [event])

  const enabled = props.showSuggestions !== false
  const matches = enabled && open && props.value.trim() && teams ? searchTeams(teams, props.value) : []
  const typedNumber = /^\d+$/.test(props.value) ? Number(props.value) : 0
  const exactTeam = teams?.some((team) => team.team_number === typedNumber) ?? false
  const partialNumberMatch = teams?.some((team) => String(team.team_number).startsWith(props.value) && team.team_number !== typedNumber) ?? false
  const notOnEvent = enabled && teams !== null && typedNumber > 0 && !exactTeam && (!open || !partialNumberMatch)

  function choose(team: TbaTeam) {
    props.onChange(String(team.team_number))
    setOpen(false)
  }

  return (
    <div className="field" style={{ position: 'relative', zIndex: matches.length > 0 ? 2 : undefined, width: 'min(18rem, 100%)', minWidth: 0 }}>
      <label htmlFor={props.id}>Team number</label>
      <input
        id={props.id}
        className="input"
        style={{ width: '9ch', minHeight: 46, fontSize: 16 }}
        inputMode="text"
        autoComplete="off"
        aria-autocomplete="list"
        aria-expanded={matches.length > 0}
        value={props.value}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          props.onChange(e.target.value)
          setOpen(true)
        }}
        onBlur={() => setOpen(false)}
        placeholder="4096"
      />
      {matches.length > 0 && (
        <div role="listbox" aria-label="Event teams" style={{ position: 'absolute', zIndex: 2, top: '100%', left: 0, width: '100%', maxHeight: 6 * 48, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 'var(--radius)', background: 'var(--surface)', boxShadow: 'var(--shadow)', padding: 4 }}>
          {matches.map((team) => (
            <button
              key={team.team_number}
              type="button"
              role="option"
              aria-selected="false"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(team)}
              style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', minHeight: 44, padding: '8px 10px', border: 0, borderRadius: 'var(--radius)', background: 'transparent', color: 'var(--ink)', textAlign: 'left', cursor: 'pointer', fontSize: 16 }}
            >
              <span className="mono" style={{ fontWeight: 700 }}>{team.team_number}</span>
              <span>{team.nickname}</span>
            </button>
          ))}
        </div>
      )}
      {notOnEvent && <p className="note" style={{ margin: 0 }}>Team {typedNumber} isn't on this event's team list. Check the number.</p>}
      {teams === null && <p className="note" style={{ margin: 0 }}>Event teams aren't available. Type a team number.</p>}
    </div>
  )
}
