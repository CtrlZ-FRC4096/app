import type { ModuleDefinition } from '../../core/registry'
import { useLessonSummary, useSignOffAttention } from './data'

export const training: ModuleDefinition = {
  id: 'training',
  name: 'Training',
  purpose: 'Lessons from the wiki, progress per student, mentor sign-offs.',
  group: 'team',
  load: () => import('./TrainingPage'),
  useSummary: useLessonSummary,
  // For mentors and admins: "3 sign-offs waiting."
  useAttention: useSignOffAttention,
}
