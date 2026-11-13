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
  /**
   * Pages inside the module, listed under its name in the menu, like Match
   * and Pit under Scouting. Leave it out and the menu shows just the module.
   * The page reads which one is open with useRoute() (src/core/router.ts).
   */
  pages?: ModulePage[]
  /** Who can open it. Leave it out to let everyone in. */
  roles?: Role[]
  /**
   * For a module where who can open a page depends on more than roles, like
   * Scouting's strategy team (#167): a hook giving the paths of the pages to
   * hide from the signed-in person, or 'all' to hide the whole module from
   * the menu and the home page. Hiding is only tidiness: the page itself must
   * still say no, and the database's rules keep the data safe.
   */
  useHiddenPages?: () => string[] | 'all'
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
  /**
   * The kinds of notification this module sends. Each gets its own switch
   * under "What to notify me about" on the Notifications page, for people
   * who can open the module. The trigger that adds them checks the switch
   * with private.wants_notification(): see
   * supabase/migrations/..._notification_settings.sql.
   */
  notifications?: NotificationKind[]
}

/** One kind of notification a module sends, like Purchasing's "My requests". */
export interface NotificationKind {
  /**
   * The module's id, a dot, then the kind in lowercase with underscores,
   * like 'purchasing.request_updates'. The trigger that sends them uses the
   * same key. Never change it: people's choices are saved under it.
   */
  key: string
  /** The switch's name, like "My requests". */
  name: string
  /** Under the switch: when it's sent, like "When something you asked for is ordered or arrives". */
  description: string
  /** Whether it's on for people who haven't chosen. The trigger must pass the same to wants_notification(). */
  on: boolean
}

/** A page inside a module, shown under the module's name in the menu. */
export interface ModulePage {
  /** Shown in the menu, like "Pit". */
  name: string
  /**
   * What comes after the module id in the address: 'pit' for #/scouting/pit,
   * or '' for the module's own address, #/scouting. Lowercase letters and dashes.
   */
  path: string
}

/** For a module with no useHiddenPages: nothing is hidden. */
export function useNothingHidden(): string[] {
  return []
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
