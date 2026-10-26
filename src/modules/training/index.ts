import type { ModuleDefinition } from '../../core/registry'

export const training: ModuleDefinition = {
  id: 'training',
  name: 'Training',
  purpose: 'Lessons from the wiki, progress per student, mentor sign-offs.',
  load: () => import('./TrainingPage'),
  // Replace this with a real summary once the module has data,
  // such as "3 parts low". See the Example module.
  summary: () => ({ tone: 'plain', text: 'Not built yet' }),
}
