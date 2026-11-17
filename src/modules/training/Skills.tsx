import { useState } from 'react'
import { shortDate } from '../../core/format'
import { useMemberNames } from '../../core/members'
import type { Result } from '../../core/table'
import { toast } from '../../core/toast'
import { Panel } from '../../core/ui'
import { SKILLS, cancelRequest, requestSignOff, useMySignOffs, type SignOff } from './data'

/** "Signed off by Pat Chen, Nov 12". */
export function SignedOffBy({ row }: { row: SignOff }) {
  const nameOf = useMemberNames()
  const day = row.signed_off_at ? shortDate(row.signed_off_at) : ''
  return (
    <span className="training-done">
      Signed off{row.signed_off_by && ` by ${nameOf(row.signed_off_by)}`}{day && `, ${day === 'Today' ? 'today' : day}`}
    </span>
  )
}

/**
 * The hands-on skills, for the signed-in person. Each shows Ask for a
 * sign-off, Waiting for a mentor (with Cancel), or who signed them off.
 */
export function Skills() {
  const mine = useMySignOffs()
  // The skill being saved, so its button can't be pressed twice.
  const [saving, setSaving] = useState<string | null>(null)
  const signedOff = SKILLS.filter((skill) => mine.get(skill.id)?.status === 'signed_off').length

  async function run(skillId: string, action: (skillId: string) => Promise<Result>) {
    setSaving(skillId)
    const result = await action(skillId)
    setSaving(null)
    if (!result.ok) toast(result.error)
  }

  return (
    <Panel title="Hands-on skills" aside={<span className="note">{signedOff} of {SKILLS.length} signed off</span>}>
      <p className="panel-body muted">
        Some tools you only use on your own once a mentor has watched you use them. When you're ready, ask for a sign-off. A mentor will
        watch you do it, then sign you off.
      </p>
      <ul className="training-list training-skills">
        {SKILLS.map((skill) => {
          const row = mine.get(skill.id)
          const busy = saving === skill.id
          return (
            <li key={skill.id}>
              <span className="training-name">
                {skill.url ? <a href={skill.url} target="_blank" rel="noopener noreferrer">{skill.name}</a> : skill.name}
              </span>
              <div className="training-actions">
                {!row && (
                  <button type="button" className="btn btn-lg btn-primary" disabled={busy} aria-label={`Ask for a sign-off: ${skill.name}`} onClick={() => void run(skill.id, requestSignOff)}>
                    Ask for a sign-off
                  </button>
                )}
                {row?.status === 'requested' && (
                  <>
                    <span className="note">Waiting for a mentor</span>
                    <button type="button" className="btn btn-lg" disabled={busy} aria-label={`Cancel your request: ${skill.name}`} onClick={() => void run(skill.id, cancelRequest)}>
                      Cancel
                    </button>
                  </>
                )}
                {row?.status === 'signed_off' && <SignedOffBy row={row} />}
              </div>
            </li>
          )
        })}
      </ul>
    </Panel>
  )
}
