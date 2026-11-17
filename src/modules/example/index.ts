// Tells the app about this module. Add it to the list in src/modules/index.ts.
import type { ModuleDefinition } from '../../core/registry'
import { useNoteSummary } from './data'

export const example: ModuleDefinition = {
  id: 'example',
  name: 'Example',
  purpose: 'A small working module to copy when you start a new one.',
  group: 'software',
  // Hidden from everyone: it's only here to be copied (#228). No role can
  // open it, so it isn't in the menus or on the home page. Leave this line
  // out when you copy this file, or nobody will be able to open your module.
  roles: [],
  load: () => import('./ExamplePage'),
  useSummary: useNoteSummary,
}
