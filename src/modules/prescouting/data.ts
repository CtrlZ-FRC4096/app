// Prescouting moved into Scouting, as its Prescouting tab (#184). This
// module only sends old links on: its data is in
// src/modules/scouting/prescouting/data.ts.
import { href } from '../../core/router'

/**
 * The new address for an old Prescouting one (#184): #/prescouting becomes
 * #/scouting/prescouting, and #/prescouting/2026ilch/9991 becomes
 * #/scouting/prescouting/2026ilch/9991. `rest` is what came after
 * #/prescouting/.
 */
export function movedHref(rest: string[]): string {
  return href('scouting', 'prescouting', ...rest)
}
