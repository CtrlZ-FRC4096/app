/**
 * Building blocks every module should use, so the app looks like one thing.
 * If you need something that isn't here, ask a mentor before adding it: a
 * change here changes every module.
 */
import type { ReactNode } from 'react'
import type { Tone } from './registry'

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

/** A number with − and + buttons. */
export function Stepper(props: { id: string; label: string; value: number; min?: number; onChange: (value: number) => void }) {
  const min = props.min ?? 0
  const set = (value: number) => props.onChange(Math.max(min, Number.isFinite(value) ? Math.round(value) : min))
  return (
    <div className="stepper">
      <button type="button" aria-label={`${props.label}: one fewer`} onClick={() => set(props.value - 1)}>−</button>
      <input id={props.id} type="number" inputMode="numeric" min={min} value={props.value} aria-label={props.label} onChange={(e) => set(Number(e.target.value))} />
      <button type="button" aria-label={`${props.label}: one more`} onClick={() => set(props.value + 1)}>+</button>
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
