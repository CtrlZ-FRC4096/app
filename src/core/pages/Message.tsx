import type { ReactNode } from 'react'
import { PageHead } from '../ui'

export function Message(props: { title: string; children: ReactNode }) {
  return (
    <>
      <PageHead eyebrow="Ctrl-Z Team App" title={props.title}>{props.children}</PageHead>
      <p><a className="btn" href="#/">Go to the home page</a></p>
    </>
  )
}
