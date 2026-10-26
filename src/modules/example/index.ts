// Tells the app about this module. Add it to the list in src/modules/index.ts.
import type { ModuleDefinition } from '../../core/registry'
import { plural } from '../../core/format'
import { noteCount } from './data'

export const example: ModuleDefinition = {
  id: 'example',
  name: 'Example',
  purpose: 'A small working module to copy when you start a new one.',
  load: () => import('./ExamplePage'),
  summary: () => ({ tone: 'info', text: plural(noteCount(), 'note', 'notes') }),
}
