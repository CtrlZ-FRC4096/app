/**
 * Every module in the app.
 *
 * The top bar sorts them into menus by the `group` each one names in its
 * index.ts (see GROUPS in src/core/registry.ts), and the home page uses the
 * same groups. Inside a group, modules appear in the order of this list.
 *
 * To add a module: make a folder next to these, export a ModuleDefinition
 * from its index.ts, and add it to this list. That's all. The home page and
 * the navigation build themselves from this list.
 * Step by step: docs/adding-a-module.md
 */
import type { ModuleDefinition } from '../core/registry'
import { inventory } from './inventory'
import { bom } from './bom'
import { scouting } from './scouting'
import { status } from './status'
import { calendar } from './calendar'
import { attendance } from './attendance'
import { members } from './members'
import { training } from './training'
import { feedback } from './feedback'
import { example } from './example'

export const modules: ModuleDefinition[] = [inventory, bom, scouting, status, calendar, attendance, members, training, feedback, example]
