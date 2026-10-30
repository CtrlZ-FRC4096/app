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

/**
 * The menus in the top bar, in the order they appear. A module says which one
 * it belongs to with `group` below, and both the top bar and the home page
 * build themselves from this list.
 *
 * Adding a group here changes the whole app, so ask a mentor first.
 */
export const GROUPS = [
  { id: 'build', name: 'Build', blurb: 'Parts, the bill of materials, and what is on the shelf.' },
  { id: 'competition', name: 'Competition', blurb: 'Scouting and the pit, for the days we play matches.' },
  { id: 'team', name: 'Team', blurb: 'The calendar, attendance, members and training.' },
  { id: 'software', name: 'Software', blurb: 'Code, widgets and the pieces this app is built from.' },
  { id: 'more', name: 'More', blurb: 'Everything else.' },
] as const

/** One of the menu names above, such as 'build'. */
export type GroupId = (typeof GROUPS)[number]['id']

export interface ModuleDefinition {
  /** Used in the address: app.team4096.org/#/<id>. Lowercase letters and dashes. */
  id: string
  /** Shown in the navigation and on the home page. */
  name: string
  /** One sentence on the home page tile and in the menu. */
  purpose: string
  /** Which menu in the top bar it sits under. Leave it out and it goes under "More". */
  group?: GroupId
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

/** A menu in the top bar, with the modules in it. */
export interface ModuleGroup {
  id: GroupId
  name: string
  blurb: string
  modules: ModuleDefinition[]
}

/**
 * Sorts modules into the menus above, keeping each module list in the order
 * it was given. Groups with nothing in them are left out, so a menu never
 * opens empty: a student who can't open Attendance or Members doesn't see
 * them, and a group only they could open doesn't show at all.
 */
export function groupModules(list: ModuleDefinition[]): ModuleGroup[] {
  return GROUPS.map((group) => ({
    id: group.id,
    name: group.name,
    blurb: group.blurb,
    modules: list.filter((m) => (m.group ?? 'more') === group.id),
  })).filter((group) => group.modules.length > 0)
}
