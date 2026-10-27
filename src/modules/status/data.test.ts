import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_ITEM_LENGTH, addPitItem, assignPitItem, movePitItem, reorderPitItem, renamePitItem, setPitItemSubgroup, checklistStore, setPitItemCompleted, subgroupMembersStore, setSubgroupMembers, belongsToSubgroup, pitChecklistSummary } from './data'
import { DEMO_PEOPLE, setDemoRole } from '../../core/demo'
import { membersTable } from '../../core/members'

beforeEach(() => {
  setDemoRole('student')
  membersTable.reset()
  subgroupMembersStore.reset()
  checklistStore.reset()
})
afterEach(() => vi.unstubAllGlobals())

describe('pit checklist', () => {
  it('adds a trimmed, unchecked item after the existing items', () => {
    const previous = [...checklistStore.get()]
    const result = addPitItem('  Check tire wear  ')
    expect(result.ok).toBe(true)
    expect(checklistStore.get().slice(0, -1)).toEqual(previous)
    expect(checklistStore.get().at(-1)).toMatchObject({ text: 'Check tire wear', completed: false })
    const second = addPitItem('Check tire wear')
    if (!result.ok || !second.ok) throw new Error('Expected items to be added')
    expect(second.value.id).not.toBe(result.value.id)
  })

  it('rejects blank or oversized items without changing the list', () => {
    const previous = checklistStore.get()
    expect(addPitItem(' \n ')).toEqual({ ok: false, error: 'Write a checklist item first.' })
    expect(addPitItem('x'.repeat(MAX_ITEM_LENGTH + 1)).ok).toBe(false)
    expect(checklistStore.get()).toBe(previous)
    expect(addPitItem('x'.repeat(MAX_ITEM_LENGTH)).ok).toBe(true)
  })

  it('checks and unchecks only the requested item', () => {
    const [first, ...others] = checklistStore.get()
    expect(setPitItemCompleted(first.id, true).ok).toBe(true)
    expect(checklistStore.get()[0].completed).toBe(true)
    expect(checklistStore.get().slice(1)).toEqual(others)
    expect(setPitItemCompleted(first.id, false).ok).toBe(true)
    expect(checklistStore.get()[0]).toEqual(first)
  })

  it('reports missing items without changing the list', () => {
    const previous = checklistStore.get()
    expect(setPitItemCompleted('missing', true).ok).toBe(false)
    expect(checklistStore.get()).toBe(previous)
  })

  it('allows only assignees to check and uncheck, including for mentors', () => {
    const [first, second] = checklistStore.get()
    const previous = checklistStore.get()
    expect(setPitItemCompleted(second.id, true).ok).toBe(false)
    expect(checklistStore.get()).toBe(previous)
    expect(setPitItemCompleted(first.id, true).ok).toBe(true)
    setDemoRole('mentor')
    expect(setPitItemCompleted(first.id, false).ok).toBe(false)
    expect(setPitItemCompleted(second.id, true).ok).toBe(true)
    setDemoRole('admin')
    expect(setPitItemCompleted(first.id, false).ok).toBe(false)
  })

  it('requires active assignees and supports multiple assigned people', () => {
    expect(addPitItem('No one assigned', []).ok).toBe(false)
    expect(addPitItem('Inactive', [DEMO_PEOPLE.sam]).ok).toBe(false)
    expect(addPitItem('Unknown', ['missing']).ok).toBe(false)
    const result = addPitItem('Shared task', [DEMO_PEOPLE.alex, DEMO_PEOPLE.pat])
    if (!result.ok) throw new Error('Expected an item')
    expect(setPitItemCompleted(result.value.id, true).ok).toBe(true)
    setDemoRole('mentor')
    expect(setPitItemCompleted(result.value.id, false).ok).toBe(true)
  })

  it('allows mentors to reassign and clears completion for the new assignee', () => {
    const [first] = checklistStore.get()
    setPitItemCompleted(first.id, true)
    expect(assignPitItem(first.id, [DEMO_PEOPLE.pat]).ok).toBe(false)
    setDemoRole('mentor')
    expect(assignPitItem(first.id, []).ok).toBe(true)
    expect(checklistStore.get()[0]).toMatchObject({ assigneeIds: [], completed: false })
    expect(assignPitItem(first.id, [DEMO_PEOPLE.sam]).ok).toBe(false)
    expect(assignPitItem('missing', [DEMO_PEOPLE.pat]).ok).toBe(false)
    expect(assignPitItem(first.id, [DEMO_PEOPLE.pat]).ok).toBe(true)
    expect(checklistStore.get()[0]).toMatchObject({ completed: false, assigneeIds: [DEMO_PEOPLE.pat] })
    expect(setPitItemCompleted(first.id, true).ok).toBe(true)
  })

  it('leaves older unassigned items locked until assigned', () => {
    checklistStore.set([{ id: 'legacy', text: 'Old item', completed: false }])
    expect(setPitItemCompleted('legacy', true).ok).toBe(false)
    setDemoRole('mentor')
    expect(assignPitItem('legacy', [DEMO_PEOPLE.pat]).ok).toBe(true)
    expect(setPitItemCompleted('legacy', true).ok).toBe(true)
  })

  it('moves items both ways and leaves boundaries and missing items unchanged', () => {
    const original = [...checklistStore.get()]
    expect(movePitItem(original[0].id, -1).ok).toBe(true)
    expect(movePitItem(original.at(-1)!.id, 1).ok).toBe(true)
    expect(movePitItem('missing', 1).ok).toBe(false)
    expect(checklistStore.get()).toEqual(original)
    movePitItem(original[0].id, 1)
    expect(checklistStore.get()).toEqual([original[1], original[0], ...original.slice(2)])
    movePitItem(original[0].id, -1)
    expect(checklistStore.get()).toEqual(original)
  })

  it('restores the starter checklist when example data is reset', () => {
    const initial = checklistStore.get()
    addPitItem('Extra check')
    setPitItemCompleted(initial[0].id, true)
    checklistStore.reset()
    expect(checklistStore.get()).toEqual(initial)
  })

  it('drags items to any position without changing assignments or checkboxes', () => {
    const original = [...checklistStore.get()]
    setPitItemCompleted(original[0].id, true)
    const checked = checklistStore.get()[0]
    expect(reorderPitItem(original[0].id, original.at(-1)!.id).ok).toBe(true)
    expect(checklistStore.get()).toEqual([...original.slice(1), checked])
    reorderPitItem(original[0].id, original[1].id)
    expect(checklistStore.get()).toEqual([checked, ...original.slice(1)])
    const previous = checklistStore.get()
    expect(reorderPitItem(original[0].id, original[0].id).ok).toBe(true)
    expect(reorderPitItem('missing', original[0].id).ok).toBe(false)
    expect(reorderPitItem(original[0].id, 'missing').ok).toBe(false)
    expect(checklistStore.get()).toBe(previous)
  })

  it('lets mentors rename an item without changing its assignments, position or completion', () => {
    const [first, ...others] = checklistStore.get()
    setPitItemCompleted(first.id, true)
    expect(renamePitItem(first.id, 'New name').ok).toBe(false)
    setDemoRole('mentor')
    expect(renamePitItem(first.id, '  Inspect battery connections  ').ok).toBe(true)
    expect(checklistStore.get()).toEqual([{ ...first, text: 'Inspect battery connections', completed: true }, ...others])
    const previous = checklistStore.get()
    expect(renamePitItem(first.id, '   ').ok).toBe(false)
    expect(renamePitItem(first.id, 'x'.repeat(MAX_ITEM_LENGTH + 1)).ok).toBe(false)
    expect(renamePitItem('missing', 'Valid name').ok).toBe(false)
    expect(checklistStore.get()).toBe(previous)
    setDemoRole('admin')
    expect(renamePitItem(first.id, 'x'.repeat(MAX_ITEM_LENGTH)).ok).toBe(true)
  })

  it('autosaves each assignment change, including clearing the last person', () => {
    const [first] = checklistStore.get()
    setDemoRole('mentor')
    expect(assignPitItem(first.id, [DEMO_PEOPLE.alex, DEMO_PEOPLE.pat]).ok).toBe(true)
    expect(checklistStore.get()[0].assigneeIds).toEqual([DEMO_PEOPLE.alex, DEMO_PEOPLE.pat])
    expect(assignPitItem(first.id, [DEMO_PEOPLE.pat]).ok).toBe(true)
    expect(checklistStore.get()[0].assigneeIds).toEqual([DEMO_PEOPLE.pat])
    expect(assignPitItem(first.id, []).ok).toBe(true)
    expect(checklistStore.get()[0].assigneeIds).toEqual([])
    expect(setPitItemCompleted(first.id, true).ok).toBe(false)
  })

  it('saves subgroup choices and lets mentors update them without changing other fields', () => {
    const result = addPitItem('Check wiring', [DEMO_PEOPLE.alex], 'Electrical')
    if (!result.ok) throw new Error('Expected an item')
    expect(result.value.subgroup).toBe('Electrical')
    expect(setPitItemSubgroup(result.value.id, 'Electrical').ok).toBe(false)
    setPitItemCompleted(result.value.id, true)
    setDemoRole('mentor')
    expect(setPitItemSubgroup(result.value.id, 'Mechanical').ok).toBe(true)
    expect(checklistStore.get().at(-1)).toEqual({ ...result.value, completed: true, subgroup: 'Mechanical' })
    const previous = checklistStore.get()
    expect(setPitItemSubgroup('missing', 'General').ok).toBe(false)
    // Runtime input validation still applies to values sent outside the picker.
    expect(setPitItemSubgroup(result.value.id, 'unknown' as 'General').ok).toBe(false)
    expect(addPitItem('Bad group', [DEMO_PEOPLE.alex], 'unknown' as 'General').ok).toBe(false)
    expect(checklistStore.get()).toBe(previous)
  })

  it('limits assignment to subgroup members and removes incompatible assignments on a tag change', () => {
    expect(addPitItem('Code', [DEMO_PEOPLE.alex], 'Programming').ok).toBe(false)
    const result = addPitItem('Code', [DEMO_PEOPLE.jordan], 'Programming')
    if (!result.ok) throw new Error('Expected an item')
    setDemoRole('mentor')
    expect(assignPitItem(result.value.id, [DEMO_PEOPLE.pat]).ok).toBe(false)
    expect(assignPitItem(result.value.id, [DEMO_PEOPLE.morgan]).ok).toBe(true)
    setDemoRole('admin')
    expect(setPitItemCompleted(result.value.id, true).ok).toBe(true)
    expect(setPitItemSubgroup(result.value.id, 'Electrical').ok).toBe(true)
    expect(checklistStore.get().at(-1)).toMatchObject({ subgroup: 'Electrical', assigneeIds: [], completed: false })
  })

  it('lets mentors manage local subgroup membership and cleans up removed assignments', () => {
    const result = addPitItem('Wiring', [DEMO_PEOPLE.alex], 'Electrical')
    if (!result.ok) throw new Error('Expected an item')
    setPitItemCompleted(result.value.id, true)
    expect(setSubgroupMembers('Electrical', [DEMO_PEOPLE.pat]).ok).toBe(false)
    setDemoRole('mentor')
    expect(setSubgroupMembers('Electrical', [DEMO_PEOPLE.sam]).ok).toBe(false)
    expect(setSubgroupMembers('General', []).ok).toBe(false)
    expect(setSubgroupMembers('Electrical', [DEMO_PEOPLE.pat]).ok).toBe(true)
    expect(belongsToSubgroup(DEMO_PEOPLE.alex, 'Electrical')).toBe(false)
    expect(checklistStore.get().at(-1)).toMatchObject({ assigneeIds: [], completed: false })
    expect(assignPitItem(result.value.id, [DEMO_PEOPLE.alex]).ok).toBe(false)
    expect(assignPitItem(result.value.id, [DEMO_PEOPLE.pat]).ok).toBe(true)
    expect(setSubgroupMembers('Electrical', []).ok).toBe(true)
    expect(assignPitItem(result.value.id, [DEMO_PEOPLE.pat]).ok).toBe(false)
  })

  it('updates the home tile summary when checks change and handles an empty list', () => {
    expect(pitChecklistSummary(checklistStore.get())).toEqual({ tone: 'plain', text: '0 of 6 pit checks' })
    setPitItemCompleted(checklistStore.get()[0].id, true)
    expect(pitChecklistSummary(checklistStore.get()).text).toBe('1 of 6 pit checks')
    setPitItemCompleted(checklistStore.get()[0].id, false)
    expect(pitChecklistSummary(checklistStore.get()).text).toBe('0 of 6 pit checks')
    expect(pitChecklistSummary(checklistStore.get().map((item) => ({ ...item, completed: true })))).toEqual({ tone: 'ok', text: '6 of 6 pit checks' })
    expect(pitChecklistSummary([])).toEqual({ tone: 'plain', text: '0 of 0 pit checks' })
  })

  it('saves additions and checkbox changes in browser storage', async () => {
    const saved = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => saved.get(key) ?? null,
      setItem: (key: string, value: string) => saved.set(key, value),
      removeItem: (key: string) => saved.delete(key),
    })
    const result = addPitItem('Saved check', [DEMO_PEOPLE.alex], 'Mechanical')
    if (!result.ok) throw new Error('Expected an item to be added')
    setPitItemCompleted(result.value.id, true)
    reorderPitItem(result.value.id, checklistStore.get().at(-2)!.id)
    vi.resetModules()
    const reloaded = await import('./data')
    expect(reloaded.checklistStore.get().at(-2)).toEqual({ ...result.value, completed: true })
  })
})
