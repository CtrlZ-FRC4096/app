// Tests for notifications.ts. They run in demo mode, as the made-up student
// Alex. Who can see and change which notifications is the database's job:
// see supabase/tests/notifications.test.ts.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEMO_PEOPLE, setDemoRole } from './demo'
import {
  addTestNotification,
  badgeText,
  bellLabel,
  deleteNotification,
  forPerson,
  markAllRead,
  markRead,
  notificationHref,
  notificationsTable,
  testNotificationText,
  unreadCount,
} from './notifications'

beforeEach(() => notificationsTable.reset())
afterEach(() => setDemoRole('student'))

const alexs = () => forPerson(notificationsTable.rows(), DEMO_PEOPLE.alex)

describe('the bell', () => {
  it('counts only new ones', () => {
    const rows = notificationsTable.rows()
    expect(unreadCount(rows)).toBe(2)
    expect(unreadCount(forPerson(rows, DEMO_PEOPLE.morgan))).toBe(0)
  })

  it('keeps its badge small', () => {
    expect(badgeText(0)).toBe('')
    expect(badgeText(3)).toBe('3')
    expect(badgeText(9)).toBe('9')
    expect(badgeText(10)).toBe('9+')
  })

  it('says how many are new to a screen reader', () => {
    expect(bellLabel(0)).toBe('Notifications')
    expect(bellLabel(2)).toBe('Notifications, 2 new')
  })
})

describe('forPerson', () => {
  it("is only that person's", () => {
    expect(alexs().every((n) => n.member_id === DEMO_PEOPLE.alex)).toBe(true)
    expect(alexs()).toHaveLength(1)
  })
})

describe('notificationHref', () => {
  it('links to pages in the app', () => {
    expect(notificationHref('./#/purchasing')).toBe('#/purchasing')
    expect(notificationHref('./#/purchasing/item/abc')).toBe('#/purchasing/item/abc')
  })

  it("never links anywhere else", () => {
    expect(notificationHref(null)).toBeNull()
    expect(notificationHref('https://example.com/')).toBeNull()
    expect(notificationHref('javascript:alert(1)')).toBeNull()
    expect(notificationHref('./#/x y')).toBeNull()
  })
})

describe('reading them', () => {
  it('marks one read, once', async () => {
    const [mine] = alexs()
    expect((await markRead(mine)).ok).toBe(true)
    const read = alexs()[0].read_at
    expect(read).not.toBeNull()
    expect((await markRead(alexs()[0])).ok).toBe(true)
    expect(alexs()[0].read_at).toBe(read)
  })

  it('marks all of yours read, and nobody else\'s', async () => {
    await addTestNotification()
    expect(unreadCount(alexs())).toBe(2)
    expect((await markAllRead()).ok).toBe(true)
    expect(unreadCount(alexs())).toBe(0)
    expect(unreadCount(forPerson(notificationsTable.rows(), DEMO_PEOPLE.pat))).toBe(1)
  })

  it('deletes one', async () => {
    const [mine] = alexs()
    expect((await deleteNotification(mine)).ok).toBe(true)
    expect(alexs()).toEqual([])
  })
})

describe('the test notification', () => {
  it('greets you by first name and opens the Notifications page', () => {
    expect(testNotificationText('Riley Park')).toEqual({ title: 'Ctrl-Z', body: 'Hi Riley! Notifications are working.', url: './#/notifications' })
    expect(testNotificationText(' ').body).toBe('Hi there! Notifications are working.')
  })

  it('is added for you, new, at the top', async () => {
    const added = await addTestNotification()
    expect(added.ok).toBe(true)
    expect(alexs()[0]).toMatchObject({ member_id: DEMO_PEOPLE.alex, title: 'Ctrl-Z', read_at: null })
  })

  it('is added for whoever you are viewing as', async () => {
    setDemoRole('mentor')
    await addTestNotification()
    expect(unreadCount(forPerson(notificationsTable.rows(), DEMO_PEOPLE.pat))).toBe(2)
    expect(alexs()).toHaveLength(1)
  })
})
