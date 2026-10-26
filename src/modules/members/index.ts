import type { ModuleDefinition } from '../../core/registry'
import { useMemberSummary } from './data'

export const members: ModuleDefinition = {
  id: 'members',
  name: 'Members',
  purpose: "Who's on the team, their roles, and who can sign in.",
  roles: ['mentor', 'admin'],
  load: () => import('./MembersPage'),
  useSummary: useMemberSummary,
}
