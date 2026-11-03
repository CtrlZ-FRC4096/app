import { useId, useState } from 'react'
import type { Member } from '../../core/members'
import { searchPeople } from './data'

/**
 * A search box with a checkbox for each person, used wherever the pit
 * checklist assigns people. Searching only hides names from the list:
 * people already checked stay checked even when they're hidden.
 */
export function PeoplePicker({ people, selectedIds, onToggle }: {
  people: Member[]
  selectedIds: string[]
  onToggle: (id: string, checked: boolean) => void
}) {
  const [query, setQuery] = useState('')
  const searchId = useId()
  const shown = searchPeople(people, query)
  const hiddenChosen = selectedIds.filter((id) => people.some((person) => person.id === id) && !shown.some((person) => person.id === id)).length

  if (people.length === 0) return null
  return (
    <>
      <label className="field" htmlFor={searchId}>
        Search people
        <input id={searchId} className="input" type="search" value={query} autoComplete="off"
          placeholder="Type a name" onChange={(event) => setQuery(event.target.value)} />
      </label>
      {shown.length === 0 && <p className="note">No one matches “{query.trim()}”. Check the spelling or clear the search.</p>}
      {hiddenChosen > 0 && <p className="note">{hiddenChosen} chosen {hiddenChosen === 1 ? 'person is' : 'people are'} hidden by the search.</p>}
      {shown.map((person) => <label key={person.id} className="check">
        <input type="checkbox" checked={selectedIds.includes(person.id)}
          onChange={(event) => onToggle(person.id, event.target.checked)} />{person.name}
      </label>)}
    </>
  )
}
