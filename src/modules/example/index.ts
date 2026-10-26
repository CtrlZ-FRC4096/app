// Tells the app about this module. Add it to the list in src/modules/index.ts.
import type { ModuleDefinition } from '../../core/registry'
import { useNoteSummary } from './data'

export const example: ModuleDefinition = {
  id: 'example',
  name: 'Example',
  purpose: 'A small working module to copy when you start a new one.',
  load: () => import('./ExamplePage'),
  useSummary: useNoteSummary,
}
