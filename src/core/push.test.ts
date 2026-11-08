// Tests for push.ts: the parts that don't need a real browser. Turning
// notifications on is tried by hand on a phone; who can save a device is
// tested in supabase/tests/push-subscriptions.test.ts.
import { describe, expect, it } from 'vitest'
import { keyBytes, pushSupport, savedDevice, testResultText, thisDevice } from './push'

const everything = { serviceWorker: true, pushManager: true, notification: true, ios: false, standalone: false }

describe('pushSupport', () => {
  it('is ready when the browser has all three parts', () => {
    expect(pushSupport(everything)).toBe('ready')
    expect(pushSupport({ ...everything, ios: true })).toBe('ready')
  })

  it('is ready on an iPhone opened from the Home Screen', () => {
    expect(pushSupport({ ...everything, ios: true, standalone: true })).toBe('ready')
  })

  it('says to add it to the Home Screen on an iPhone in Safari, which never offers them', () => {
    expect(pushSupport({ ...everything, pushManager: false, notification: false, ios: true })).toBe('add-to-home-screen')
  })

  it('says to update an iPhone that is opened from the Home Screen but too old', () => {
    expect(pushSupport({ ...everything, pushManager: false, notification: false, ios: true, standalone: true })).toBe('update-iphone')
  })

  it("is unsupported when something's missing on anything else", () => {
    expect(pushSupport({ ...everything, serviceWorker: false })).toBe('unsupported')
    expect(pushSupport({ ...everything, notification: false })).toBe('unsupported')
  })

  it('is unsupported where there is no browser at all, like the tests', () => {
    expect(pushSupport(thisDevice())).toBe('unsupported')
  })
})

describe('keyBytes', () => {
  it('turns base64url text into bytes, with or without padding', () => {
    expect([...keyBytes('AQID')]).toEqual([1, 2, 3])
    expect([...keyBytes('_-8')]).toEqual([255, 239])
    expect([...keyBytes('AQ')]).toEqual([1])
  })

  it('gives the 65 bytes of a real-length public key', () => {
    expect(keyBytes('B' + 'A'.repeat(86))).toHaveLength(65)
  })
})

describe('savedDevice', () => {
  it("keeps the address and the two keys from the browser's subscription", () => {
    expect(savedDevice({ endpoint: 'https://push.example.com/1', keys: { p256dh: 'abc', auth: 'def' } })).toEqual({
      endpoint: 'https://push.example.com/1',
      p256dh: 'abc',
      auth: 'def',
    })
  })

  it('is null if any part is missing', () => {
    expect(savedDevice({ endpoint: 'https://push.example.com/1', keys: { p256dh: 'abc' } })).toBeNull()
    expect(savedDevice({ keys: { p256dh: 'abc', auth: 'def' } })).toBeNull()
    expect(savedDevice({})).toBeNull()
  })
})

describe('testResultText', () => {
  it('says how many devices it reached', () => {
    expect(testResultText({ sent: 1, removed: 0, failed: 0 })).toBe('Sent to 1 of your devices.')
    expect(testResultText({ sent: 2, removed: 0, failed: 0 })).toBe('Sent to 2 of your devices.')
  })

  it('says when a device was removed or could not be reached', () => {
    expect(testResultText({ sent: 1, removed: 1, failed: 0 })).toBe("Sent to 1 of your devices. One device was turned off there, so it's been removed.")
    expect(testResultText({ sent: 0, removed: 0, failed: 2 })).toBe("Didn't reach any of your devices. 2 of your devices couldn't be reached. Try again in a minute.")
  })
})
