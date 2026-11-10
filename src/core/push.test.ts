// Tests for push.ts: the parts that don't need a real browser. Turning
// notifications on is tried by hand on a phone; who can save a device is
// tested in supabase/tests/push-subscriptions.test.ts.
import { describe, expect, it } from 'vitest'
import {
  BLOCKED_TEXT,
  SUPPORT_TEXT,
  countSaved,
  detailLines,
  keyBytes,
  otherDevicesText,
  pushServiceName,
  pushSupport,
  removeOtherDevices,
  removedText,
  savedDevice,
  showTestHere,
  testResultText,
  thisDevice,
  type PushDetails,
} from './push'

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

describe('pushServiceName', () => {
  it("keeps only the push service's name, never the rest of the address, which works like a password", () => {
    expect(pushServiceName('https://fcm.googleapis.com/fcm/send/secret-part:XYZ')).toBe('fcm.googleapis.com')
    expect(pushServiceName('https://web.push.apple.com/QGsecret')).toBe('web.push.apple.com')
  })

  it("says unknown for something that isn't an address", () => {
    expect(pushServiceName('not an address')).toBe('unknown')
    expect(pushServiceName('')).toBe('unknown')
  })
})

describe('detailLines', () => {
  const working: PushDetails = {
    address: 'https://app.team4096.org/',
    secure: true,
    permission: 'granted',
    worker: 'running',
    workerScope: 'https://app.team4096.org/',
    pushService: 'fcm.googleapis.com',
    saved: { thisOne: true, others: 0 },
    demo: false,
  }
  const line = (details: PushDetails, label: string) => detailLines(details).find((l) => l.label === label)

  it('is all OK when everything is set up', () => {
    expect(detailLines(working).map((l) => l.tone)).toEqual(['ok', 'ok', 'ok', 'ok', 'ok'])
    expect(line(working, 'Site address')?.text).toBe('https://app.team4096.org/')
    expect(line(working, 'Service worker')?.text).toBe('Running, for https://app.team4096.org/')
    expect(line(working, 'Push service')?.text).toBe('fcm.googleapis.com')
    expect(line(working, 'Your devices')?.text).toBe('Just this one.')
  })

  it('says to use https on an address that is not secure', () => {
    const http = line({ ...working, address: 'http://app.team4096.org/', secure: false }, 'Site address')
    expect(http?.tone).toBe('warn')
    expect(http?.text).toContain('https://')
  })

  it('says how to unblock notifications when the browser blocks them', () => {
    expect(line({ ...working, permission: 'denied' }, 'Browser permission')).toEqual({ label: 'Browser permission', tone: 'warn', text: BLOCKED_TEXT })
    expect(line({ ...working, permission: 'default' }, 'Browser permission')?.tone).toBe('plain')
    expect(line({ ...working, permission: 'missing' }, 'Browser permission')?.tone).toBe('warn')
  })

  it("says what's not set up yet before notifications are turned on", () => {
    const off = { ...working, permission: 'default' as const, worker: 'none' as const, workerScope: null, pushService: null, saved: { thisOne: false, others: 0 } }
    expect(detailLines(off).map((l) => l.tone)).toEqual(['ok', 'plain', 'plain', 'plain', 'plain'])
    expect(line(off, 'Service worker')?.text).toContain('Turn on')
    expect(line(off, 'Push service')?.text).toContain('Turn on')
    expect(line(off, 'Your devices')?.text).toContain('Turn on')
  })

  it('counts your other saved devices', () => {
    expect(line({ ...working, saved: { thisOne: true, others: 2 } }, 'Your devices')?.text).toBe('This one, and 2 other devices.')
  })

  it("says to turn off and on again when this device is on but isn't saved, so nothing can reach it", () => {
    const lost = line({ ...working, saved: { thisOne: false, others: 1 } }, 'Your devices')
    expect(lost?.tone).toBe('warn')
    expect(lost?.text).toBe("This device isn't saved, so notifications can't reach it. Tap Turn off, then Turn on. You have 1 other device saved.")
  })

  it("mentions other saved devices when it's not on here, like one from the old address", () => {
    const off = { ...working, pushService: null, saved: { thisOne: false, others: 1 } }
    expect(line(off, 'Your devices')).toEqual({ label: 'Your devices', tone: 'plain', text: 'Not this one yet. You have 1 other device saved.' })
  })

  it("says when your devices couldn't be read, and that demo mode doesn't save any", () => {
    expect(line({ ...working, saved: null }, 'Your devices')?.tone).toBe('warn')
    expect(line({ ...working, saved: null, demo: true }, 'Your devices')?.text).toContain('demo mode')
  })

  it('says a service worker that is starting needs a moment', () => {
    expect(line({ ...working, worker: 'starting' }, 'Service worker')?.text).toContain('Reload')
  })

  it('explains there is no push service in demo mode', () => {
    expect(line({ ...working, pushService: null, demo: true }, 'Push service')?.text).toContain('demo mode')
  })
})

describe('countSaved', () => {
  const saved = ['https://push.example.com/1', 'https://push.example.com/2', 'https://push.example.com/3']

  it('finds this device among your saved ones and counts the rest', () => {
    expect(countSaved(saved, 'https://push.example.com/2')).toEqual({ thisOne: true, others: 2 })
  })

  it("counts them all as others when this device isn't saved, or isn't on", () => {
    expect(countSaved(saved, 'https://push.example.com/9')).toEqual({ thisOne: false, others: 3 })
    expect(countSaved(saved, null)).toEqual({ thisOne: false, others: 3 })
    expect(countSaved([], null)).toEqual({ thisOne: false, others: 0 })
  })
})

describe('removing your other devices', () => {
  it('counts them in words', () => {
    expect(otherDevicesText(1)).toBe('1 other device')
    expect(otherDevicesText(3)).toBe('3 other devices')
  })

  it('says how many it removed, and how to get one back', () => {
    expect(removedText(0)).toBe('You had no other devices saved.')
    expect(removedText(2)).toBe('Removed 2 other devices. To use one again, open the app on it and turn notifications back on.')
  })

  it('has nothing to remove in demo mode, like the tests', async () => {
    expect(await removeOtherDevices()).toEqual({ ok: true, value: "Demo mode doesn't save devices, so there's nothing to remove." })
  })
})

describe('showTestHere', () => {
  it("says why when this browser can't show notifications, like the tests", async () => {
    expect(await showTestHere()).toEqual({ ok: false, error: SUPPORT_TEXT.unsupported })
  })
})
