import type { ModuleDefinition } from '../../core/registry'
import { useLessonSummary } from './data'

export const training: ModuleDefinition = {
  id: 'training',
  name: 'Training',
  purpose: 'Lessons from the wiki, progress per student, mentor sign-offs.',
  group: 'team',
  load: () => import('./TrainingPage'),
  useSummary: useLessonSummary,
}
