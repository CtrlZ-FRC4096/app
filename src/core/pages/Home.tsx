import { modules } from '../../modules'
import { canOpen, useSession, type Role } from '../session'
import { href } from '../router'
import { PageHead, Panel, Pill } from '../ui'
import { QuietBoundary } from '../ErrorBoundary'
import type { ModuleDefinition } from '../registry'

const ADD_MODULE_DOC = 'https://github.com/CtrlZ-FRC4096/app/blob/main/docs/adding-a-module.md'

export function Home() {
  const { name, role } = useSession()
  const open = modules.filter((m) => canOpen(role, m.roles))

  return (
    <>
      <PageHead eyebrow="Team 4096 · Ctrl-Z" title={`Hi ${name.split(' ')[0]}`}>
        Everything the team tracks, in one place. Each tool below is a module: a folder in the app's repo that plugs into the same sign-in, roles and navigation.
      </PageHead>

      <Panel title="Needs attention" aside={<span className="note">Pulled from every module</span>}>
        {/* Each module adds its own lines. If none do, the list is empty and the note below shows instead. */}
        <div className="row-list attention-list">
          {open.map((m) => m.useAttention && (
            <QuietBoundary key={m.id}>
              <Attention module={m} role={role} />
            </QuietBoundary>
          ))}
        </div>
        <p className="panel-body muted attention-empty">Nothing needs attention right now.</p>
      </Panel>

      <section className="stack">
        <h2>Modules</h2>
        <div className="modules">
          {open.map((m) => (
            <a key={m.id} className="panel tile" href={href(m.id)}>
              <span className="tile-top">
                <h3>{m.name}</h3>
                {m.useSummary && (
                  <QuietBoundary>
                    <Summary module={m} role={role} />
                  </QuietBoundary>
                )}
              </span>
              <span className="muted">{m.purpose}</span>
              <span className="tile-open">Open {m.name} →</span>
            </a>
          ))}
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

function Summary({ module, role }: { module: ModuleDefinition; role: Role }) {
  const summary = module.useSummary!(role)
  return <Pill tone={summary.tone}>{summary.text}</Pill>
}

function Attention({ module, role }: { module: ModuleDefinition; role: Role }) {
  const notices = module.useAttention!(role)
  return notices.map((notice) => (
    <a key={notice.text} href={href(module.id)} style={{ color: 'inherit', textDecoration: 'none' }}>
      <Pill tone={notice.tone}>{module.name}</Pill>
      <span>{notice.text}</span>
      <span className="note" style={{ marginLeft: 'auto' }}>Open →</span>
    </a>
  ))
}
