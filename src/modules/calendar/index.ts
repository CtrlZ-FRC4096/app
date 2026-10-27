// Tells the app about this module. It's listed in src/modules/index.ts.
import type { ModuleDefinition } from '../../core/registry'
import { useCalendarSummary } from './data'

export const calendar: ModuleDefinition = {
  id: 'calendar',
  name: 'Calendar',
  purpose: "What's coming up on the team calendar: build sessions, outreach and competitions.",
  load: () => import('./CalendarPage'),
  useSummary: useCalendarSummary,
}
