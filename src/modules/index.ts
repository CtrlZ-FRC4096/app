/**
 * Every module in the app, in the order they appear in the navigation.
 *
 * To add a module: make a folder next to these, export a ModuleDefinition
 * from its index.ts, and add it to this list. That's all. The home page and
 * the navigation build themselves from this list.
 * Step by step: docs/adding-a-module.md
 */
import type { ModuleDefinition } from '../core/registry'
import { inventory } from './inventory'
import { training } from './training'
import { bom } from './bom'
import { scouting } from './scouting'
import { status } from './status'
import { calendar } from './calendar'
import { attendance } from './attendance'
import { example } from './example'
import { members } from './members'

export const modules: ModuleDefinition[] = [inventory, training, bom, scouting, status, calendar, attendance, example, members]
