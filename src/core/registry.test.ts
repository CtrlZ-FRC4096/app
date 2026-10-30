import { describe, expect, it } from 'vitest'
import { GROUPS, groupModules, type GroupId, type ModuleDefinition } from './registry'

function fakeModule(id: string, group?: GroupId): ModuleDefinition {
  return { id, name: id, purpose: 'Something for the tests.', group, load: async () => ({ default: () => null }) }
}

describe('the groups in the top bar', () => {
  it('each have a name and a blurb', () => {
    for (const group of GROUPS) {
      expect(group.name.trim()).not.toBe('')
      expect(group.blurb.trim()).not.toBe('')
    }
  })
})

describe('groupModules', () => {
  it('lists the groups in the order they are written, whatever order the modules come in', () => {
    const groups = groupModules([fakeModule('members', 'team'), fakeModule('bom', 'build')])
    expect(groups.map((g) => g.id)).toEqual(['build', 'team'])
    expect(groups[0].modules.map((m) => m.id)).toEqual(['bom'])
    expect(groups[1].modules.map((m) => m.id)).toEqual(['members'])
  })

  it('keeps the modules inside a group in the order they were listed', () => {
    const groups = groupModules([fakeModule('bom', 'build'), fakeModule('inventory', 'build')])
    expect(groups[0].modules.map((m) => m.id)).toEqual(['bom', 'inventory'])
  })

  it('puts a module that does not say which group it is in under More', () => {
    const groups = groupModules([fakeModule('pit-map')])
    expect(groups.map((g) => g.id)).toEqual(['more'])
    expect(groups[0].modules.map((m) => m.id)).toEqual(['pit-map'])
  })

  it('leaves out a group with nothing in it, so no menu opens empty', () => {
    const groups = groupModules([fakeModule('bom', 'build')])
    expect(groups.map((g) => g.id)).toEqual(['build'])
  })

  it('has nothing to show when nobody can open anything', () => {
    expect(groupModules([])).toEqual([])
  })
})
