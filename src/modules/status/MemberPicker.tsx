import { useId, useState } from 'react'
import { matchMembers } from './data'

/**
 * A "Find someone" box above a list of checkboxes, one per person.
 * Searching only hides names: people already chosen always stay in the list.
 */
export function MemberPicker({ members, chosenIds, onChange }: {
  members: { id: string; name: string }[]
  chosenIds: string[]
  onChange: (id: string, chosen: boolean) => void
}) {
  const [search, setSearch] = useState('')
  const searchId = useId()
  if (members.length === 0) return null
  const shown = matchMembers(members, search, chosenIds)
  const nobody = search.trim() !== '' && matchMembers(members, search).length === 0

  return (
    <>
      <label className="field" htmlFor={searchId}>
        Find someone
        <input id={searchId} className="input" type="search" value={search} placeholder="Name"
          onChange={(event) => setSearch(event.target.value)} />
      </label>
      {nobody && <p className="note" role="status">No one matches “{search.trim()}”.</p>}
      {shown.map((member) => <label key={member.id} className="check">
        <input type="checkbox" checked={chosenIds.includes(member.id)}
          onChange={(event) => onChange(member.id, event.target.checked)} />{member.name}
      </label>)}
    </>
  )
}
