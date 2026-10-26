import { modules } from '../../modules'
import { canOpen, useSession } from '../session'
import { href } from '../router'
import { PageHead, Panel, Pill } from '../ui'
import type { Notice } from '../registry'

const ADD_MODULE_DOC = 'https://github.com/CtrlZ-FRC4096/app/blob/main/docs/adding-a-module.md'

export function Home() {
  const { name, role } = useSession()
  const open = modules.filter((m) => canOpen(role, m.roles))
  const attention: (Notice & { id: string; module: string })[] = open.flatMap((m) =>
    (m.attention?.(role) ?? []).map((notice) => ({ ...notice, id: m.id, module: m.name })),
  )

  return (
    <>
      <PageHead eyebrow="Team 4096 · Ctrl-Z" title={`Hi ${name.split(' ')[0]}`}>
        Everything the team tracks, in one place. Each tool below is a module: a folder in the app's repo that plugs into the same sign-in, roles and navigation.
      </PageHead>

      <Panel title="Needs attention" aside={<span className="note">Pulled from every module</span>}>
        {attention.length === 0 ? (
          <p className="panel-body muted">Nothing needs attention right now.</p>
        ) : (
          <div className="row-list">
            {attention.map((a) => (
              <a key={a.id + a.text} href={href(a.id)} style={{ color: 'inherit', textDecoration: 'none' }}>
                <Pill tone={a.tone}>{a.module}</Pill>
                <span>{a.text}</span>
                <span className="note" style={{ marginLeft: 'auto' }}>Open →</span>
              </a>
            ))}
          </div>
        )}
      </Panel>

      <section className="stack">
        <h2>Modules</h2>
        <div className="modules">
          {open.map((m) => {
            const summary = m.summary?.(role)
            return (
              <a key={m.id} className="panel tile" href={href(m.id)}>
                <span className="tile-top">
                  <h3>{m.name}</h3>
                  {summary && <Pill tone={summary.tone}>{summary.text}</Pill>}
                </span>
                <span className="muted">{m.purpose}</span>
                <span className="tile-open">Open {m.name} →</span>
              </a>
            )
          })}
          <div className="panel tile add">
            <h3>Add a module</h3>
            <span className="muted">
              Make a folder in <span className="mono">src/modules/</span> and add one line to <span className="mono">src/modules/index.ts</span>. It shows up here and in the navigation.
            </span>
            <a href={ADD_MODULE_DOC} target="_blank" rel="noopener">How to add a module ↗</a>
          </div>
        </div>
      </section>
    </>
  )
}
