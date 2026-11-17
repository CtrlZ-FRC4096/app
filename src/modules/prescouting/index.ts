// Prescouting moved into Scouting, as its Prescouting tab (#184). This tiny
// module only keeps old #/prescouting links and bookmarks working: its page
// sends them to the same place in the new tab. It's hidden from the menu
// and the home page for everyone.
import type { ModuleDefinition } from '../../core/registry'

/** Hidden from the menu and the home page for everyone: Prescouting is in Scouting now. */
function useHiddenEverywhere(): 'all' {
  return 'all'
}

export const prescouting: ModuleDefinition = {
  id: 'prescouting',
  name: 'Prescouting',
  purpose: 'Old Prescouting links: they open the Prescouting tab in Scouting.',
  group: 'competition',
  load: () => import('./MovedPage'),
  useHiddenPages: useHiddenEverywhere,
}
