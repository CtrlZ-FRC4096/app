import { useRef, useState } from 'react'
import { pickablePeople } from './data'

type Person = { id: string; name: string }

/**
 * Choosing people, the same everywhere on the page: the chosen people at
 * the top as name tags (tap one to take them off), a "Find someone" box,
 * and under it the people who can be added (tap one to add them). Nothing
 * is a checkbox, and it's sized for a thumb.
 *
 * `pool` is everyone who may be chosen. With `suggestedIds`, for when the
 * pool is the whole team, only those people are listed until a name is
 * typed. pickablePeople() in data.ts decides who is listed.
 */
export function PeoplePicker(props: {
  /** For the Find someone box, so a popup can focus it when it opens. */
  findId: string
  chosen: Person[]
  pool: Person[]
  suggestedIds?: string[]
  /** What to say when the pool is empty, like how to set up the subgroup. */
  nobody?: string
  disabled?: boolean
  onAdd: (id: string) => void
  onRemove: (id: string) => void
}) {
  const [search, setSearch] = useState('')
  const find = useRef<HTMLInputElement>(null)
  const shown = pickablePeople(props.pool, props.chosen.map((person) => person.id), search, props.suggestedIds)
  const typed = search.trim() !== ''
  function add(id: string) {
    props.onAdd(id)
    // Ready for the next name.
    setSearch('')
    find.current?.focus()
  }
  const everyoneChosen = props.pool.length > 0 && props.pool.every((person) => props.chosen.some((c) => c.id === person.id))

  return (
    <div className="pit-people-picker">
      <div className="pit-chips" role="group" aria-label="Chosen people">
        {props.chosen.length === 0 && <span className="note">Nobody yet.</span>}
        {props.chosen.map((person) => (
          <button key={person.id} type="button" className="pit-chip pit-chip-remove" disabled={props.disabled}
            aria-label={`Take ${person.name} off`} title={`Take ${person.name} off`} onClick={() => props.onRemove(person.id)}>
            {person.name}<span aria-hidden="true">×</span>
          </button>
        ))}
      </div>
      <label className="field" htmlFor={props.findId}>
        Find someone
        <input ref={find} id={props.findId} className="input pit-find" type="search" value={search} placeholder="Name"
          autoComplete="off" autoCorrect="off" spellCheck={false} enterKeyHint="done" onChange={(event) => setSearch(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return
            // Enter adds the first name listed. It never sends the form the picker is in.
            event.preventDefault()
            if (typed && shown[0] && !props.disabled) add(shown[0].id)
          }} />
      </label>
      <div className="pit-person-options" role="group" aria-label="People to add">
        {shown.map((person) => (
          <button key={person.id} type="button" className="pit-person-option" disabled={props.disabled} onClick={() => add(person.id)}>
            <span aria-hidden="true">+</span>{person.name}
          </button>
        ))}
      </div>
      <p className="note" role="status" style={{ margin: 0 }}>
        {shown.length > 0 ? ''
          : props.pool.length === 0 ? (props.nobody ?? 'Nobody to choose from.')
          : typed ? `No one matches “${search.trim()}”.`
          : everyoneChosen ? 'Everyone here is already chosen.'
          : 'Type a name to find someone.'}
      </p>
      {shown.length > 0 && props.suggestedIds && !typed && <p className="note" style={{ margin: 0 }}>These people are on other items. Type a name to find anyone else.</p>}
    </div>
  )
}
