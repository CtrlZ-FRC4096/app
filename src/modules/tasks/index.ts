// Tells the app about this module. It's listed in src/modules/index.ts.
import type { ModuleDefinition } from '../../core/registry'
import { useTaskAttention, useTaskSummary } from './data'

export const tasks: ModuleDefinition = {
  id: 'tasks',
  name: 'Task board',
  purpose: 'Jobs for each subteam: move yours along, and see who is doing what.',
  group: 'team',
  load: () => import('./TasksPage'),
  useSummary: useTaskSummary,
  useAttention: useTaskAttention,
}
