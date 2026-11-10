import type { ReactNode } from 'react'

/**
 * One section of a scouting form, like "Scoring" or "Strategy". A form is
 * one panel, and each section after the first has a line above it, so the
 * sections read as parts of one thing.
 */
export default function FormSection(props: { title: string; first?: boolean; children: ReactNode }) {
  return (
    <div className="panel-body" style={props.first ? undefined : { borderTop: '1px solid var(--line)' }}>
      <h3>{props.title}</h3>
      {props.children}
    </div>
  )
}
