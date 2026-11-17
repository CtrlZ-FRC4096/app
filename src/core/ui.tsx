/**
 * Building blocks every module should use, so the app looks like one thing.
 * If you need something that isn't here, ask a mentor before adding it: a
 * change here changes every module.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Tone } from './registry'
import { parseCount } from './format'
import { pickablePeople } from './members'

export function PageHead(props: { title: string; eyebrow?: string; children?: ReactNode }) {
  return (
    <section className="page-head">
      {/* Most pages don't need a line above the title: the top bar already says where you are. */}
      {props.eyebrow && <p className="eyebrow">{props.eyebrow}</p>}
      <h1>{props.title}</h1>
      {props.children && <p className="lede">{props.children}</p>}
    </section>
  )
}

export function Panel(props: { title?: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={'panel' + (props.className ? ' ' + props.className : '')}>
      {(props.title || props.aside) && (
        <div className="panel-head">
          {typeof props.title === 'string' ? <h2>{props.title}</h2> : props.title}
          {props.aside}
        </div>
      )}
      {props.children}
    </section>
  )
}

/**
 * Scrolls its contents to the top of the screen, clear of the top bar, when it
 * first appears. Wrap a form that opens away from the button that opened it,
 * and give the wrapper a `key` so it scrolls again when it opens for something
 * else: `<InView key={part.id}><PartForm … /></InView>`.
 */
export function InView(props: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  // Braces, so the effect returns nothing: newer Chrome returns a Promise from scrollIntoView().
  useEffect(() => {
    ref.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }, [])
  return <div ref={ref} style={{ scrollMarginTop: 160 }}>{props.children}</div>
}

export function Pill(props: { tone: Tone; children: ReactNode }) {
  return <span className={'pill ' + props.tone}>{props.children}</span>
}

export function Bar(props: { value: number; label: string }) {
  const percent = Math.round(Math.max(0, Math.min(1, props.value)) * 100)
  return (
    <div className="bar" role="progressbar" aria-label={props.label} aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
      <span style={{ width: percent + '%' }} />
    </div>
  )
}

export function Callout(props: { title: string; children: ReactNode }) {
  return (
    <div className="callout">
      <strong>{props.title}</strong>
      {props.children}
    </div>
  )
}

/**
 * A number with − and + buttons.
 *
 * While someone types, the box can be empty or below the minimum, so they
 * can delete the old number and type a new one. Whole numbers at or above
 * the minimum count straight away; anything else is settled when they leave
 * the box or press Enter: rounded and raised to the minimum, or the last
 * good number if the box is empty.
 */
export function Stepper(props: { id: string; label: string; value: number; min?: number; onChange: (value: number) => void }) {
  const min = props.min ?? 0
  // What's typed in the box while someone types, or null to show props.value.
  const [typed, setTyped] = useState<string | null>(null)
  const step = (by: number) => {
    setTyped(null)
    props.onChange(Math.max(min, props.value + by))
  }
  const edit = (text: string) => {
    setTyped(text)
    const value = parseCount(text, min)
    if (value !== null && String(value) === text.trim()) props.onChange(value)
  }
  const settle = () => {
    if (typed === null) return
    const value = parseCount(typed, min)
    if (value !== null && value !== props.value) props.onChange(value)
    setTyped(null)
  }
  return (
    <div className="stepper">
      <button type="button" aria-label={`${props.label}: one fewer`} onClick={() => step(-1)}>−</button>
      <input
        id={props.id}
        type="number"
        inputMode="numeric"
        min={min}
        value={typed ?? props.value}
        aria-label={props.label}
        onChange={(e) => edit(e.target.value)}
        onBlur={settle}
        onKeyDown={(e) => e.key === 'Enter' && settle()}
      />
      <button type="button" aria-label={`${props.label}: one more`} onClick={() => step(1)}>+</button>
    </div>
  )
}

/** A row of buttons where one is chosen. */
export function Pick<T extends string | number>(props: { label: string; options: T[]; value: T; onChange: (value: T) => void }) {
  return (
    <div className="pick" role="group" aria-label={props.label}>
      {props.options.map((option) => (
        <button key={String(option)} type="button" aria-pressed={option === props.value} onClick={() => props.onChange(option)}>
          {option}
        </button>
      ))}
    </div>
  )
}

type Person = { id: string; name: string }

/**
 * Choosing people: the chosen people at the top as name tags (tap one to
 * take them off), a "Find someone" box, and under it the people who can be
 * added (tap one to add them). Nothing is a checkbox, and it's sized for a
 * thumb. Used by the Pit checklist and Training's "Sign people off" form.
 *
 * `pool` is everyone who may be chosen. With `suggestedIds`, for when the
 * pool is the whole team, only those people are listed until a name is
 * typed. pickablePeople() in members.ts decides who is listed.
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
    <div className="people-picker">
      <div className="people-picker-chosen" role="group" aria-label="Chosen people">
        {props.chosen.length === 0 && <span className="note">Nobody yet.</span>}
        {props.chosen.map((person) => (
          <button key={person.id} type="button" className="person-chip person-chip-remove" disabled={props.disabled}
            aria-label={`Take ${person.name} off`} title={`Take ${person.name} off`} onClick={() => props.onRemove(person.id)}>
            {person.name}<span aria-hidden="true">×</span>
          </button>
        ))}
      </div>
      <label className="field" htmlFor={props.findId}>
        Find someone
        <input ref={find} id={props.findId} className="input people-picker-find" type="search" value={search} placeholder="Name"
          autoComplete="off" autoCorrect="off" spellCheck={false} enterKeyHint="done" onChange={(event) => setSearch(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return
            // Enter adds the first name listed. It never sends the form the picker is in.
            event.preventDefault()
            if (typed && shown[0] && !props.disabled) add(shown[0].id)
          }} />
      </label>
      <div className="people-picker-options" role="group" aria-label="People to add">
        {shown.map((person) => (
          <button key={person.id} type="button" className="people-picker-option" disabled={props.disabled} onClick={() => add(person.id)}>
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

const REPO = 'https://github.com/CtrlZ-FRC4096/app'

/**
 * The page for a module nobody has built yet. It says what the module is
 * for, so whoever picks it up knows where to start. Replace it with a real
 * page when you build the module.
 */
export function ComingSoon(props: { id: string; name: string; goal: string; mustHave: string[] }) {
  return (
    <>
      <PageHead title={props.name}>{props.goal}</PageHead>
      <Panel title="What it needs to do" aside={<Pill tone="plain">Not built yet</Pill>}>
        <ul className="goal-list">
          {props.mustHave.map((item) => <li key={item}>{item}</li>)}
        </ul>
      </Panel>
      <Callout title="Want to build this?">
        <span>
          Read <a href={`${REPO}/blob/main/src/modules/${props.id}/README.md`} target="_blank" rel="noopener">the {props.name} README</a> and
          pick an <a href={`${REPO}/issues?q=is%3Aopen+label%3A${props.id}`} target="_blank" rel="noopener">open {props.name} issue</a>.
          The Example module shows how a working module fits together.
        </span>
      </Callout>
    </>
  )
}
