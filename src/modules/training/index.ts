import type { ModuleDefinition } from '../../core/registry'

export const training: ModuleDefinition = {
  id: 'training',
  name: 'Training',
  purpose: 'Lessons from the wiki, progress per student, mentor sign-offs.',
  group: 'team',
  load: () => import('./TrainingPage'),
  // Replace this with a hook from data.ts once the module has data, such
  // as "3 parts low". See useNoteSummary in the Example module.
  useSummary: () => ({ tone: 'plain', text: 'Not built yet' }),
}
