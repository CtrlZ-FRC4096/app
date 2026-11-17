import { useState } from 'react'
import { plural } from '../../core/format'
import { toast } from '../../core/toast'
import { Bar, Panel } from '../../core/ui'
import { SignedOffBy } from './Skills'
import { COURSES, SKILLS, signOffsFor, takeBack, useAllSignOffs, useEveryonesProgress, type PersonProgress, type SignOff } from './data'

/**
 * For mentors and admins: how far everyone has got, least done first. Tap a
 * person to see their lessons and skills. The database only lets mentors and
 * admins read everyone's progress, so hiding this from students is tidiness.
 */
export function EveryonesProgress() {
  const everyone = useEveryonesProgress()
  const signOffs = useAllSignOffs()
  const [search, setSearch] = useState('')
  // The person whose lessons are showing.
  const [open, setOpen] = useState<string | null>(null)
  const wanted = search.trim().toLowerCase()
  const shown = wanted ? everyone.filter((person) => person.name.toLowerCase().includes(wanted)) : everyone

  return (
    <Panel title="Everyone's progress" aside={<span className="note">{plural(everyone.length, 'person', 'people')}</span>}>
      <div className="panel-body">
        <p className="muted">Least done first, so you can see who needs a nudge. Tap a name to see their lessons and skills.</p>
        <label className="field" htmlFor="training-find">
          Find someone
          <input id="training-find" className="input" type="search" value={search} placeholder="Name" onChange={(event) => setSearch(event.target.value)} />
        </label>
      </div>
      {shown.length === 0 ? (
        <p className="panel-body muted" role="status">
          {everyone.length === 0 ? 'Nobody to show yet. Students show up here once they sign in.' : `No one matches “${search.trim()}”.`}
        </p>
      ) : (
        <ul className="training-list training-people">
          {shown.map((person) => {
            const skills = signOffsFor(signOffs, person.personId)
            const signedOff = SKILLS.filter((skill) => skills.get(skill.id)?.status === 'signed_off').length
            const isOpen = open === person.personId
            return (
              <li key={person.personId}>
                <button type="button" className="training-person" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : person.personId)}>
                  <span className="training-person-name">{person.name}</span>
                  <span className="tnum">{person.done} of {person.total}</span>
                </button>
                <Bar value={person.total ? person.done / person.total : 0} label={`${person.name}: lessons done`} />
                <p className="note">
                  {person.byCourse.map((course) => `${course.name} ${course.done}/${course.total}`).join(' · ')} · Skills {signedOff}/{SKILLS.length}
                </p>
                {isOpen && <PersonDetail person={person} skills={skills} />}
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}

/** One person's lessons, course by course, and their hands-on skills, with Take back on each sign-off. */
function PersonDetail({ person, skills }: { person: PersonProgress; skills: Map<string, SignOff> }) {
  // The sign-off being taken back, so its button can't be pressed twice.
  const [saving, setSaving] = useState<string | null>(null)

  async function undo(row: SignOff) {
    setSaving(row.id)
    const result = await takeBack(row)
    setSaving(null)
    toast(result.ok ? `Took back the sign-off. ${person.name} can ask again later.` : result.error)
  }

  return (
    <div className="training-detail">
      {COURSES.map((course) => (
        <section key={course.name}>
          <h3>{course.name}</h3>
          <ul className="training-ticks">
            {course.lessons.map((lesson) => (
              <li key={lesson.id}>
                <span>{lesson.title}</span>
                {person.lessons.has(lesson.id) ? <span className="training-done">Done</span> : <span className="note">Not yet</span>}
              </li>
            ))}
          </ul>
        </section>
      ))}
      <section>
        <h3>Hands-on skills</h3>
        <ul className="training-ticks">
          {SKILLS.map((skill) => {
            const row = skills.get(skill.id)
            return (
              <li key={skill.id}>
                <span>{skill.name}</span>
                {!row && <span className="note">Not yet</span>}
                {row?.status === 'requested' && <span className="note">Waiting for a mentor</span>}
                {row?.status === 'signed_off' && (
                  <span className="training-actions">
                    <SignedOffBy row={row} />
                    <button type="button" className="btn btn-sm" disabled={saving === row.id} aria-label={`Take back ${person.name}'s sign-off: ${skill.name}`} onClick={() => void undo(row)}>
                      Take back
                    </button>
                  </span>
                )}
              </li>
            )
          })}
        </ul>
      </section>
    </div>
  )
}
