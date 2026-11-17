import { useState, type FormEvent } from 'react'
import { plural } from '../../core/format'
import { useMemberNames } from '../../core/members'
import type { Result } from '../../core/table'
import { toast } from '../../core/toast'
import { Panel, Pill } from '../../core/ui'
import { MemberPicker } from '../status/MemberPicker'
import { SKILLS, signOff, signOffPeople, skillName, turnDown, useLearners, useWaitingRequests, waitingTime, type SignOff } from './data'

/**
 * For mentors and admins: the requests waiting for a sign-off, oldest first,
 * each with Sign off and Not yet. Below them, signing people off without a
 * request. The database stops anyone else, whatever the page shows.
 */
export function SignOffRequests() {
  const waiting = useWaitingRequests()
  const nameOf = useMemberNames()
  // The request being saved, so its buttons can't be pressed twice.
  const [saving, setSaving] = useState<string | null>(null)
  const [signing, setSigning] = useState(false)

  async function decide(request: SignOff, action: (request: SignOff) => Promise<Result>, done: string) {
    setSaving(request.id)
    const result = await action(request)
    setSaving(null)
    toast(result.ok ? done : result.error)
  }

  return (
    <Panel title="Waiting for sign-off" aside={<Pill tone={waiting.length ? 'warn' : 'ok'}>{waiting.length} waiting</Pill>}>
      {waiting.length === 0 ? (
        <p className="panel-body muted">Nobody is waiting. When someone asks for a sign-off, it shows up here.</p>
      ) : (
        <ul className="training-list">
          {waiting.map((request) => {
            const who = nameOf(request.created_by)
            const skill = skillName(request.skill_id)
            return (
              <li key={request.id}>
                <span className="training-name">
                  <strong>{who}</strong>: {skill}
                  <br />
                  <span className="note">Waiting {waitingTime(request.created_at)}</span>
                </span>
                <div className="training-actions">
                  <button type="button" className="btn btn-primary" disabled={saving === request.id} aria-label={`Sign off ${who}: ${skill}`}
                    onClick={() => void decide(request, signOff, `Signed off ${who} on ${skill}.`)}>
                    Sign off
                  </button>
                  <button type="button" className="btn" disabled={saving === request.id} aria-label={`Not yet: ${who}, ${skill}`}
                    onClick={() => void decide(request, turnDown, `Turned down. ${who} can ask again later.`)}>
                    Not yet
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
      <div className="panel-body">
        {signing ? (
          <SignOffForm onClose={() => setSigning(false)} />
        ) : (
          <div className="toolbar">
            <button type="button" className="btn training-tap" onClick={() => setSigning(true)}>Sign people off without a request</button>
          </div>
        )}
      </div>
    </Panel>
  )
}

/** Pick a skill and the people, such as everyone at a shop safety session, and sign them all off. */
function SignOffForm({ onClose }: { onClose: () => void }) {
  const people = useLearners()
  const [skillId, setSkillId] = useState(SKILLS[0].id)
  const [chosen, setChosen] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    const result = await signOffPeople(skillId, chosen)
    setSaving(false)
    if (!result.ok) {
      toast(result.error)
      return
    }
    const skill = skillName(skillId)
    toast(result.value === 0 ? `They were all already signed off on ${skill}.` : `Signed off ${plural(result.value, 'person', 'people')} on ${skill}.`)
    onClose()
  }

  return (
    <form className="training-form" onSubmit={submit}>
      <h3>Sign people off</h3>
      <p className="note">For when you've watched people use a tool without them asking, like after a shop safety session. Anyone already signed off is left as they are.</p>
      <label className="field" htmlFor="training-signoff-skill">
        Skill
        <select id="training-signoff-skill" className="input" value={skillId} onChange={(event) => setSkillId(event.target.value)}>
          {SKILLS.map((skill) => <option key={skill.id} value={skill.id}>{skill.name}</option>)}
        </select>
      </label>
      <div className="training-picker">
        <MemberPicker members={people} chosenIds={chosen}
          onChange={(id, isChosen) => setChosen((ids) => (isChosen ? [...ids, id] : ids.filter((other) => other !== id)))} />
      </div>
      <div className="toolbar">
        <button type="submit" className="btn btn-primary training-tap" disabled={saving || chosen.length === 0}>
          {saving ? 'Signing off…' : `Sign off ${plural(chosen.length, 'person', 'people')}`}
        </button>
        <button type="button" className="btn training-tap" onClick={onClose}>Cancel</button>
      </div>
    </form>
  )
}
