import { useState } from 'react'
import { ROLES, isAdmin, roleName, useSession, type Role } from '../../core/session'
import { initials, useMembers, type Member } from '../../core/members'
import { isLive } from '../../core/supabase'
import { toast } from '../../core/toast'
import { shortDate } from '../../core/format'
import { Callout, PageHead, Panel, Pill } from '../../core/ui'
import { changeRole, search, setAccess } from './data'

export default function MembersPage() {
  const { id: myId, role: myRole } = useSession()
  const members = useMembers()
  const [text, setText] = useState('')
  const found = search(members, text)
  const active = found.filter((m) => m.active)
  const off = found.filter((m) => !m.active)
  const canChange = isAdmin(myRole)

  async function role(member: Member, next: Role) {
    const result = await changeRole(member, next)
    toast(result.ok ? `${member.name} is now ${next === 'admin' ? 'an' : 'a'} ${next}.` : result.error)
  }

  async function access(member: Member, on: boolean) {
    const result = await setAccess(member, on)
    toast(result.ok ? `${member.name}'s access is ${on ? 'back on' : 'switched off'}.` : result.error)
  }

  return (
    <>
      <PageHead eyebrow="Team 4096 · Ctrl-Z" title="Members">
        Everyone who has signed in with Slack. People start as students. Admins can make someone a mentor or an admin, or
        switch off access for someone who has left the team.
      </PageHead>
      {!isLive && (
        <Callout title="Demo mode">
          <span>These are made-up people. Once the team database is set up, this list fills in as people sign in with Slack.</span>
        </Callout>
      )}
      <label className="field" htmlFor="member-search" style={{ maxWidth: 360 }}>
        Find someone
        <input id="member-search" className="input" type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Name" />
      </label>
      <Panel title="On the team" aside={<span className="note">{active.length} shown</span>}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Name</th><th>Role</th><th>Joined</th>{canChange && <th>Access</th>}</tr>
            </thead>
            <tbody>
              {active.map((m) => (
                <tr key={m.id}>
                  <td><Person member={m} you={m.id === myId} /></td>
                  <td>
                    {canChange && m.id !== myId ? (
                      <select className="input" aria-label={`Role for ${m.name}`} value={m.role} onChange={(e) => void role(m, e.target.value as Role)}>
                        {ROLES.map((r) => <option key={r} value={r}>{roleName(r)}</option>)}
                      </select>
                    ) : (
                      <Pill tone={m.role === 'student' ? 'plain' : 'info'}>{roleName(m.role)}</Pill>
                    )}
                  </td>
                  <td className="note">{shortDate(m.created_at)}</td>
                  {canChange && (
                    <td>
                      {m.id !== myId && <button type="button" className="btn btn-sm" onClick={() => void access(m, false)}>Switch off</button>}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      {off.length > 0 && (
        <Panel title="Access switched off" aside={<span className="note">Can't sign in or see anything</span>}>
          <div className="row-list">
            {off.map((m) => (
              <div key={m.id}>
                <Person member={m} />
                {canChange && (
                  <button type="button" className="btn btn-sm" style={{ marginLeft: 'auto' }} onClick={() => void access(m, true)}>Switch back on</button>
                )}
              </div>
            ))}
          </div>
        </Panel>
      )}
    </>
  )
}

function Person({ member, you }: { member: Member; you?: boolean }) {
  return (
    <span className="member">
      {member.avatar_url ? (
        <img className="avatar" src={member.avatar_url} alt="" />
      ) : (
        <span className="avatar" aria-hidden="true">{initials(member.name)}</span>
      )}
      <span>{member.name}{you && <span className="note"> (you)</span>}</span>
    </span>
  )
}
