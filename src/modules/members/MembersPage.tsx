import { useState } from 'react'
import { ROLES, isAdmin, isLeader, isMentor, roleName, useSession, type Role } from '../../core/session'
import { initials, useMembers, type Member } from '../../core/members'
import { isLive } from '../../core/supabase'
import { toast } from '../../core/toast'
import { shortDate } from '../../core/format'
import { Callout, PageHead, Panel, Pill } from '../../core/ui'
import { changeRole, checkServerFunctions, search, setAccess, type FunctionCheck } from './data'
// Purchasers are Purchasing's: read and change them through its data.ts (#144).
import { canBeBuyer, canChooseBuyers, setBuyer, useBuyers } from '../purchasing/data'
// The scouting strategy team is Scouting's: read and change it through its data.ts (#167).
import { addStrategyMember, removeStrategyMember, strategyTable } from '../scouting/data'

export default function MembersPage() {
  const { id: myId, role: myRole } = useSession()
  const members = useMembers()
  const [text, setText] = useState('')
  const found = search(members, text)
  const active = found.filter((m) => m.active)
  const off = found.filter((m) => !m.active)
  const canChange = isAdmin(myRole)
  const buyers = useBuyers()
  const isBuyer = (m: Member) => buyers.some((b) => b.member_id === m.id)
  const strategy = new Set(strategyTable.useRows().map((s) => s.member_id))

  async function role(member: Member, next: Role) {
    const result = await changeRole(member, next)
    toast(result.ok ? `${member.name} is now ${next === 'admin' ? 'an' : 'a'} ${roleName(next).toLowerCase()}.` : result.error)
  }

  async function purchaser(member: Member, on: boolean) {
    const result = await setBuyer(member.id, on)
    toast(result.ok ? `${member.name} ${on ? 'is now a purchaser' : 'is no longer a purchaser'}.` : result.error)
  }

  async function setStrategy(member: Member, on: boolean) {
    const result = on ? await addStrategyMember(member.id) : await removeStrategyMember(member.id)
    toast(result.ok ? `${member.name} is ${on ? 'now on' : 'off'} the strategy team.` : result.error)
  }

  async function access(member: Member, on: boolean) {
    const result = await setAccess(member, on)
    toast(result.ok ? `${member.name}'s access is ${on ? 'back on' : 'switched off'}.` : result.error)
  }

  return (
    <>
      <PageHead title="Members">
        Everyone who has signed in. Admins set roles, and switch off access for anyone who has left. Mentors and admins choose
        the purchasers, who place orders in Purchasing along with them, and the scouting strategy team, who see the scouting analysis and Prescouting.
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
        {text.trim() && found.length === 0 ? (
          <div className="panel-body">
            <p className="muted" style={{ margin: 0 }}>Nobody matches “{text.trim()}”.</p>
            <div className="toolbar"><button type="button" className="btn" onClick={() => setText('')}>Clear the search</button></div>
          </div>
        ) : (
          <div className="table-wrap">
            {/*
              Two columns, so the table fits on a phone: when each person joined, and the
              admins' Switch off button, sit under their name; the Purchaser and Strategy team ticks under their role.
            */}
            <table>
              <thead>
                <tr><th>Name</th><th>Role</th></tr>
              </thead>
              <tbody>
                {active.map((m) => (
                  <tr key={m.id}>
                    <td>
                      <Person member={m} you={m.id === myId} />
                      <span className="note">Joined {shortDate(m.created_at)}</span>
                      {canChange && m.id !== myId && (
                        <div style={{ marginTop: 6 }}>
                          <button type="button" className="btn btn-sm" onClick={() => void access(m, false)}>Switch off access</button>
                        </div>
                      )}
                    </td>
                    <td>
                      {canChange && m.id !== myId ? (
                        <select className="input" aria-label={`Role for ${m.name}`} value={m.role} onChange={(e) => void role(m, e.target.value as Role)}>
                          {ROLES.map((r) => <option key={r} value={r}>{roleName(r)}</option>)}
                        </select>
                      ) : (
                        <Pill tone={m.role === 'student' ? 'plain' : 'info'}>{roleName(m.role)}</Pill>
                      )}
                      {/* Mentors and admins already place orders, so they don't need it. */}
                      {canBeBuyer(m) && (canChooseBuyers(myRole) ? (
                        <label className="check" style={{ display: 'flex', minHeight: 40 }}>
                          <input type="checkbox" aria-label={`${m.name} is a purchaser`} checked={isBuyer(m)} onChange={(e) => void purchaser(m, e.target.checked)} />
                          Purchaser
                        </label>
                      ) : (
                        isBuyer(m) && <> <Pill tone="info">Purchaser</Pill></>
                      ))}
                      {/* Student leaders, mentors and admins always count as strategy (#167). */}
                      {!isLeader(m.role) && (isMentor(myRole) ? (
                        <label className="check" style={{ display: 'flex', minHeight: 40 }}>
                          <input type="checkbox" aria-label={`${m.name} is on the strategy team`} checked={strategy.has(m.id)} onChange={(e) => void setStrategy(m, e.target.checked)} />
                          Strategy team
                        </label>
                      ) : (
                        strategy.has(m.id) && <> <Pill tone="info">Strategy team</Pill></>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      {off.length > 0 && (
        <Panel title="Access switched off">
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
      {isLive && <ServerFunctions />}
    </>
  )
}

/** For mentors setting up keys: are the server functions deployed, and do the keys work? */
function ServerFunctions() {
  const [checks, setChecks] = useState<FunctionCheck[] | null>(null)
  const [checking, setChecking] = useState(false)

  async function check() {
    setChecking(true)
    setChecks(await checkServerFunctions())
    setChecking(false)
  }

  return (
    <Panel
      title="Server functions"
      aside={<button type="button" className="btn btn-sm" disabled={checking} onClick={() => void check()}>{checking ? 'Checking…' : 'Check them'}</button>}
    >
      {checks ? (
        <div className="row-list">
          {checks.map((c) => (
            <div key={c.name}>
              <Pill tone={c.ok ? 'ok' : 'warn'}>{c.ok ? 'OK' : 'Not yet'}</Pill>
              <span><strong>{c.name}.</strong> {c.text}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="panel-body muted">
          Keys for other services, like The Blue Alliance, Slack and Google Calendar, live in server functions on Supabase. After
          setting one up, check it works here. Checking sends you a test message in Slack.
        </p>
      )}
    </Panel>
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
