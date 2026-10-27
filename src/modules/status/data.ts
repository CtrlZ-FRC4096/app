import { createStore, useStore } from '../../core/store'
import { fail, ok, type Result } from '../../core/table'
import { currentUser, isMentor } from '../../core/session'
import { membersTable } from '../../core/members'
import { DEMO_PEOPLE } from '../../core/demo'
import type { Notice } from '../../core/registry'

export const PIT_SUBGROUPS = ['General', 'Mechanical', 'Electrical', 'Programming', 'Drive team'] as const
export type PitSubgroup = typeof PIT_SUBGROUPS[number]

// Example associations for this local preview, editable by mentors.
export const subgroupMembersStore = createStore<Record<string, string[]>>('status:subgroup-members', 1, () => ({
  Mechanical: [DEMO_PEOPLE.alex, DEMO_PEOPLE.jordan],
  Electrical: [DEMO_PEOPLE.alex, DEMO_PEOPLE.pat],
  Programming: [DEMO_PEOPLE.jordan, DEMO_PEOPLE.morgan],
  'Drive team': [DEMO_PEOPLE.alex, DEMO_PEOPLE.pat],
}))

export function useSubgroupMembers() {
  return useStore(subgroupMembersStore)
}

export function belongsToSubgroup(id: string, subgroup: PitSubgroup): boolean {
  return subgroup === 'General' || !!subgroupMembersStore.get()[subgroup]?.includes(id)
}

export function setSubgroupMembers(subgroup: PitSubgroup, ids: string[]): Result {
  const user = currentUser()
  if (!user || !isMentor(user.role)) return fail('Ask a mentor to edit subgroup members.')
  if (!PIT_SUBGROUPS.includes(subgroup) || subgroup === 'General') return fail('General includes all active team members.')
  if (ids.some((id) => !membersTable.rows().some((member) => member.id === id && member.active))) return fail('Choose active team members.')
  subgroupMembersStore.set((groups) => ({ ...groups, [subgroup]: [...new Set(ids)] }))
  checklistStore.set((items) => items.map((item) => {
    if (item.subgroup !== subgroup) return item
    const assigneeIds = item.assigneeIds?.filter((id) => ids.includes(id)) ?? []
    return assigneeIds.length === (item.assigneeIds?.length ?? 0) ? item : { ...item, assigneeIds, completed: false }
  }))
  return ok(null)
}

export interface PitItem {
  id: string
  text: string
  completed: boolean
  /** Older local-preview items have no assignment yet. */
  assigneeIds?: string[]
  /** Existing preview items default to General. */
  subgroup?: PitSubgroup
}

export const MAX_ITEM_LENGTH = 200

// Browser-only preview for issue 10. Shared storage needs a mentor-approved
// createTable table, migration and permission tests.
export const checklistStore = createStore<PitItem[]>('status:pit-checklist-preview', 1, () => [
  { id: 'battery', text: 'Batteries charged and numbered', completed: false, assigneeIds: [DEMO_PEOPLE.alex] },
  { id: 'bumpers', text: 'Both bumper colors packed', completed: false, assigneeIds: [DEMO_PEOPLE.pat] },
  { id: 'weight', text: 'Robot weighed', completed: false, assigneeIds: [DEMO_PEOPLE.alex] },
  { id: 'code', text: 'Code deployed', completed: false, assigneeIds: [DEMO_PEOPLE.pat] },
  { id: 'laptop', text: 'Driver station laptop charged', completed: false, assigneeIds: [DEMO_PEOPLE.alex] },
  { id: 'glasses', text: 'Safety glasses for everyone in the pit', completed: false, assigneeIds: [DEMO_PEOPLE.pat] },
])

export function usePitChecklist(): PitItem[] {
  return useStore(checklistStore)
}

export function pitChecklistSummary(items: PitItem[]): Notice {
  const done = items.filter((item) => item.completed).length
  return { tone: items.length > 0 && done === items.length ? 'ok' : 'plain', text: `${done} of ${items.length} pit checks` }
}

export function usePitSummary(): Notice {
  return pitChecklistSummary(usePitChecklist())
}

function checkAssignees(ids: string[], subgroup: PitSubgroup = 'General', allowEmpty = false): string | null {
  if (!ids.length && !allowEmpty) return 'Assign at least one person to this item.'
  if (ids.some((id) => !membersTable.rows().some((member) => member.id === id && member.active))) {
    return 'Choose active team members for this item.'
  }
  if (ids.some((id) => !belongsToSubgroup(id, subgroup))) return `Choose people from ${subgroup}.`
  return null
}

export function addPitItem(text: string, assigneeIds: string[] = [currentUser()?.id ?? ''], subgroup: PitSubgroup = 'General'): Result<PitItem> {
  const trimmed = text.trim()
  if (!trimmed) return fail('Write a checklist item first.')
  if (trimmed.length > MAX_ITEM_LENGTH) return fail(`Keep checklist items to ${MAX_ITEM_LENGTH} characters or fewer.`)
  const problem = checkAssignees(assigneeIds, subgroup)
  if (problem) return fail(problem)
  if (!PIT_SUBGROUPS.includes(subgroup)) return fail('Choose a subgroup from the list.')
  const item = { id: crypto.randomUUID(), text: trimmed, completed: false, assigneeIds: [...new Set(assigneeIds)], subgroup }
  checklistStore.set((items) => [...items, item])
  return ok(item)
}

export function setPitItemCompleted(id: string, completed: boolean): Result<PitItem> {
  const item = checklistStore.get().find((item) => item.id === id)
  if (!item) return fail('That item is no longer on the checklist. Try another item.')
  const user = currentUser()
  if (!user || !membersTable.rows().some((member) => member.id === user.id && member.active) || !item.assigneeIds?.includes(user.id) || !belongsToSubgroup(user.id, item.subgroup ?? 'General')) {
    return fail('Only people assigned to this item can check or uncheck it.')
  }
  const updated = { ...item, completed }
  checklistStore.set((items) => items.map((item) => item.id === id ? updated : item))
  return ok(updated)
}

export function assignPitItem(id: string, assigneeIds: string[]): Result {
  const user = currentUser()
  if (!user || !isMentor(user.role)) return fail('Ask a mentor to change the people assigned to this item.')
  const item = checklistStore.get().find((item) => item.id === id)
  if (!item) return fail('That item is no longer on the checklist.')
  const problem = checkAssignees(assigneeIds, item.subgroup ?? 'General', true)
  if (problem) return fail(problem)
  checklistStore.set((items) => items.map((item) => item.id === id
    ? { ...item, assigneeIds: [...new Set(assigneeIds)], completed: false } : item))
  return ok(null)
}

export function setPitItemSubgroup(id: string, subgroup: PitSubgroup): Result {
  const user = currentUser()
  if (!user || !isMentor(user.role)) return fail('Ask a mentor to change this item’s subgroup.')
  if (!PIT_SUBGROUPS.includes(subgroup)) return fail('Choose a subgroup from the list.')
  if (!checklistStore.get().some((item) => item.id === id)) return fail('That item is no longer on the checklist.')
  checklistStore.set((items) => items.map((item) => {
    if (item.id !== id) return item
    const assigneeIds = item.assigneeIds?.filter((id) => belongsToSubgroup(id, subgroup)) ?? []
    return { ...item, subgroup, assigneeIds, completed: assigneeIds.length === (item.assigneeIds?.length ?? 0) ? item.completed : false }
  }))
  return ok(null)
}

export function renamePitItem(id: string, text: string): Result {
  const user = currentUser()
  if (!user || !isMentor(user.role)) return fail('Ask a mentor to rename this item.')
  const trimmed = text.trim()
  if (!trimmed) return fail('Write a checklist item first.')
  if (trimmed.length > MAX_ITEM_LENGTH) return fail(`Keep checklist items to ${MAX_ITEM_LENGTH} characters or fewer.`)
  if (!checklistStore.get().some((item) => item.id === id)) return fail('That item is no longer on the checklist.')
  checklistStore.set((items) => items.map((item) => item.id === id ? { ...item, text: trimmed } : item))
  return ok(null)
}

export function reorderPitItem(id: string, targetId: string): Result {
  const items = [...checklistStore.get()]
  const from = items.findIndex((item) => item.id === id)
  const to = items.findIndex((item) => item.id === targetId)
  if (from < 0 || to < 0) return fail('That item is no longer on the checklist.')
  if (from === to) return ok(null)
  const [item] = items.splice(from, 1)
  items.splice(to, 0, item)
  checklistStore.set(items)
  return ok(null)
}

export function movePitItem(id: string, direction: -1 | 1): Result {
  const items = [...checklistStore.get()]
  const from = items.findIndex((item) => item.id === id)
  if (from < 0) return fail('That item is no longer on the checklist.')
  const to = from + direction
  if (to < 0 || to >= items.length) return ok(null)
  ;[items[from], items[to]] = [items[to], items[from]]
  checklistStore.set(items)
  return ok(null)
}
