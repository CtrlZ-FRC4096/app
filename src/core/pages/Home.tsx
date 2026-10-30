import { modules } from '../../modules'
import { canOpen, useSession, type Role } from '../session'
import { href } from '../router'
import { groupModules, type ModuleDefinition } from '../registry'
import { PageHead, Panel, Pill } from '../ui'
import { QuietBoundary } from '../ErrorBoundary'

const ADD_MODULE_DOC = 'https://github.com/CtrlZ-FRC4096/app/blob/main/docs/adding-a-module.md'

export function Home() {
  const { name, role } = useSession()
  // The same groups as the menus in the top bar, so both read the same way.
  const groups = groupModules(modules.filter((m) => canOpen(role, m.roles)))

  return (
    <>
      <PageHead eyebrow="Team 4096 · Ctrl-Z" title={`Hi ${name.split(' ')[0]}`}>
        Everything the team tracks, in one place.
      </PageHead>

      <Panel title="Needs attention" aside={<span className="note">Pulled from every module</span>}>
        {/* Each module adds its own lines. If none do, the list is empty and the note below shows instead. */}
        <div className="row-list attention-list">
          {groups.flatMap((group) => group.modules.map((m) => m.useAttention && (
            <QuietBoundary key={m.id}>
              <Attention module={m} role={role} />
            </QuietBoundary>
          )))}
        </div>
        <p className="panel-body muted attention-empty">Nothing needs attention right now.</p>
      </Panel>

      {groups.map((group) => (
        <section className="home-group" key={group.id}>
          <div className="home-group-head">
            <h2>{group.name}</h2>
            <span className="note">{group.blurb}</span>
          </div>
          <div className="modules">
            {group.modules.map((m) => <Tile key={m.id} module={m} role={role} />)}
          </div>
        </section>
      ))}

      <section className="home-group">
        <div className="home-group-head">
          <h2>Add to the app</h2>
          <span className="note">Each tool above is a module: a folder that plugs into the same sign-in, roles and navigation.</span>
        </div>
        <div className="modules">
          <div className="panel tile add">
            <h3>Add a module</h3>
            <p className="muted">
              Make a folder in <span className="mono">src/modules/</span> and add one line to <span className="mono">src/modules/index.ts</span>. It shows up here and in the menus.
            </p>
            <p><a href={ADD_MODULE_DOC} target="_blank" rel="noopener">How to add a module ↗</a></p>
          </div>
        </div>
      </section>
    </>
  )
}

function Tile({ module, role }: { module: ModuleDefinition; role: Role }) {
  return (
    <a className="panel tile" href={href(module.id)}>
      <div className="tile-top">
        <h3>{module.name}</h3>
        {module.useSummary && (
          <QuietBoundary>
            <Summary module={module} role={role} />
          </QuietBoundary>
        )}
      </div>
      <p className="muted">{module.purpose}</p>
      <p className="tile-open">Open {module.name} <i>→</i></p>
    </a>
  )
}

function Summary({ module, role }: { module: ModuleDefinition; role: Role }) {
  const summary = module.useSummary!(role)
  return <Pill tone={summary.tone}>{summary.text}</Pill>
}

function Attention({ module, role }: { module: ModuleDefinition; role: Role }) {
  const notices = module.useAttention!(role)
  return notices.map((notice) => (
    <a key={notice.text} href={href(module.id)}>
      <Pill tone={notice.tone}>{module.name}</Pill>
      <span>{notice.text}</span>
      <span className="note open">Open →</span>
    </a>
  ))
}
