import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { THEMES, resolveTheme, setTheme, useTheme } from './theme'

/** useTheme is a hook, so read it from what a component draws. */
function chosenTheme(): string {
  function Probe() {
    return createElement('span', null, useTheme())
  }
  return renderToString(createElement(Probe)).replace(/<[^>]*>/g, '')
}

describe('resolveTheme', () => {
  it('follows the device when nobody has chosen', () => {
    expect(resolveTheme('System', true)).toBe('dark')
    expect(resolveTheme('System', false)).toBe('light')
  })

  it('uses what someone chose, whatever the device says', () => {
    expect(resolveTheme('Light', true)).toBe('light')
    expect(resolveTheme('Dark', false)).toBe('dark')
  })
})

describe('the choice', () => {
  it('offers the device, light and dark', () => {
    expect([...THEMES]).toEqual(['System', 'Light', 'Dark'])
  })

  it('starts on System and remembers what it changes to', () => {
    expect(chosenTheme()).toBe('System')
    setTheme('Dark')
    expect(chosenTheme()).toBe('Dark')
    setTheme('System')
    expect(chosenTheme()).toBe('System')
  })
})
