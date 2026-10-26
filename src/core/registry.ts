/**
 * What a module tells the app about itself.
 *
 * Each module folder exports one of these from its index.ts, and
 * src/modules/index.ts lists them. The home page, the navigation and the
 * status page all build themselves from that list.
 */
import type { ComponentType } from 'react'
import type { Role } from './roles'

export type Tone = 'ok' | 'warn' | 'crit' | 'info' | 'plain'

export interface Notice {
  tone: Tone
  text: string
}

export interface ModuleDefinition {
  /** Used in the address: app.team4096.org/#/<id>. Lowercase letters and dashes. */
  id: string
  /** Shown in the navigation and on the home page. */
  name: string
  /** One sentence on the home page tile. */
  purpose: string
  /** Who can open it. Leave it out to let everyone in. */
  roles?: Role[]
  /** Loads the page only when someone opens it, so one module can't slow the others down. */
  load: () => Promise<{ default: ComponentType }>
  /**
   * A short status for the home page tile, such as "3 parts low on stock".
   * It's a hook, so it can read rows: export it from data.ts, like
   * useNoteSummary in the Example module.
   */
  useSummary?: (role: Role) => Notice
  /** Anything that needs someone's attention, shown under "Needs attention" on the home page. A hook, like useSummary. */
  useAttention?: (role: Role) => Notice[]
}
