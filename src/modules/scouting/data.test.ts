// Tests for data.ts, in demo mode: the tests never call The Blue Alliance.
// The server function itself is tested in supabase/tests/functions.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEMO_PEOPLE } from '../../core/demo'
import { resetAllStores } from '../../core/store'
import { fail } from '../../core/table'
import {
  MAX_NOTES_LENGTH,
  checkEntry,
  entriesTable,
  entriesToSend,
  entryStore,
  getRankings,
  getSchedule,
  getTeam,
  getTeamMatches,
  saveEntry,
  syncEntries,
  teamNumber,
  type Entry,
  type EntryFields,
} from './data'
import { EVENT_KEY } from './season'

// A filled-in form. Each test changes only the part it's about.
const FORM: EntryFields = {
  match: 12,
  team: 9991,
  counts: { autoFuel: 3, teleopFuel: 14, fuelMissed: 2 },
  endgame: 'Level 2',
  roles: ['Scorer', 'Defender'],
  broke_down: true,
  stop: 'A-stop',
  driver_skill: 4,
  notes: '  Fast cycles  ',
}

describe('saveEntry', () => {
  beforeEach(() => {
    entryStore.reset()
  })

  it('saves what the scout entered, marked as not synced yet', () => {
    const result = saveEntry(FORM)
    if (!result.ok) throw new Error(result.error)
    expect(entryStore.get()).toEqual([result.value])
    expect(result.value).toMatchObject({ ...FORM, notes: 'Fast cycles', event: EVENT_KEY, synced: false })
    expect(result.value.scouted_by).not.toBeNull()
  })

  it('refuses notes too long for the team database', () => {
    expect(checkEntry({ ...FORM, notes: 'x'.repeat(MAX_NOTES_LENGTH) })).toBeNull()
    expect(checkEntry({ ...FORM, notes: 'x'.repeat(MAX_NOTES_LENGTH + 1) })).toMatch(/^Keep the notes under/)
  })

  it('lists entries newest first, each with its own id', () => {
    saveEntry(FORM)
    saveEntry({ ...FORM, match: 13 })
    expect(entryStore.get().map((e) => e.match)).toEqual([13, 12])
    expect(entryStore.get()[0].id).not.toBe(entryStore.get()[1].id)
  })

  it('refuses an entry with no team and says why', () => {
    expect(saveEntry({ ...FORM, team: 0 })).toEqual({ ok: false, error: 'Enter the team number first.' })
    expect(saveEntry({ ...FORM, team: Number.NaN })).toEqual({ ok: false, error: 'Enter the team number first.' })
    expect(entryStore.get()).toEqual([])
  })

  it('refuses an entry with no match number', () => {
    expect(checkEntry({ ...FORM, match: 0 })).toBe('Enter the match number first.')
    expect(checkEntry(FORM)).toBeNull()
  })

  it('refuses an entry until a driver skill from 1 to 5 is chosen', () => {
    // The form sends 0 while no driver skill is chosen.
    expect(saveEntry({ ...FORM, driver_skill: 0 })).toEqual({ ok: false, error: 'Choose a driver skill first.' })
    expect(checkEntry({ ...FORM, driver_skill: 6 })).toBe('Choose a driver skill first.')
    expect(checkEntry({ ...FORM, driver_skill: 1 })).toBeNull()
    expect(checkEntry({ ...FORM, driver_skill: 5 })).toBeNull()
    expect(entryStore.get()).toEqual([])
  })

  it('saves an entry with no role chosen', () => {
    const result = saveEntry({ ...FORM, roles: [] })
    expect(result).toMatchObject({ ok: true, value: { roles: [] } })
  })

  it('keeps entries when the example data is reset', () => {
    saveEntry(FORM)
    resetAllStores()
    expect(entryStore.get()).toHaveLength(1)
  })
})

describe('syncEntries', () => {
  beforeEach(() => {
    entryStore.reset()
    entriesTable.reset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  /** Save an entry from the form, and return it. */
  function save(fields: Partial<EntryFields> = {}): Entry {
    const result = saveEntry({ ...FORM, ...fields })
    if (!result.ok) throw new Error(result.error)
    return result.value
  }

  const inTable = (id: string) => entriesTable.rows().filter((row) => row.id === id)

  it('sends a Waiting entry to the team table and marks it Synced', async () => {
    const entry = save()
    expect(await syncEntries()).toEqual({ ok: true, value: 1 })
    expect(entryStore.get()[0].synced).toBe(true)
    expect(inTable(entry.id)).toEqual([
      expect.objectContaining({ created_at: entry.created_at, created_by: entry.scouted_by, event: EVENT_KEY, match: 12, team: 9991, notes: 'Fast cycles' }),
    ])
  })

  it('makes one row when the same entry is sent twice', async () => {
    const entry = save()
    await syncEntries()
    // As if the phone never heard back the first time.
    entryStore.set((entries) => entries.map((e) => ({ ...e, synced: false })))
    expect(await syncEntries()).toEqual({ ok: true, value: 1 })
    expect(inTable(entry.id)).toHaveLength(1)
  })

  it('has nothing to send once everything is Synced', async () => {
    save()
    await syncEntries()
    expect(await syncEntries()).toEqual({ ok: true, value: 0 })
  })

  it('sends an entry only once when asked twice at the same time', async () => {
    const insert = vi.spyOn(entriesTable, 'insert')
    save()
    const [first, second] = await Promise.all([syncEntries(), syncEntries()])
    expect(first).toEqual(second)
    expect(insert).toHaveBeenCalledTimes(1)
  })

  it('fills in fields an entry saved before they were on the form is missing', async () => {
    const old = save()
    // The shape entries had when "Played defense" was on the form.
    const { event: _event, roles: _roles, broke_down: _brokeDown, stop: _stop, driver_skill: _skill, ...rest } = old
    entryStore.set([{ ...rest, defense: true } as unknown as Entry])
    await syncEntries()
    expect(inTable(old.id)[0]).toMatchObject({ event: EVENT_KEY, roles: [], broke_down: false, stop: 'None', driver_skill: null })
    expect(inTable(old.id)[0]).not.toHaveProperty('defense')
  })

  it('keeps entries Waiting with no connection', async () => {
    vi.stubGlobal('navigator', { onLine: false })
    const entry = save()
    expect(await syncEntries()).toEqual({ ok: false, error: "No connection. Entries will send when it's back." })
    expect(entryStore.get()[0].synced).toBe(false)
    expect(inTable(entry.id)).toEqual([])
  })

  it('keeps entries Waiting when sending fails, and sends them next time', async () => {
    vi.spyOn(entriesTable, 'insert').mockResolvedValueOnce(fail("Couldn't reach the team database."))
    save()
    expect((await syncEntries()).ok).toBe(false)
    expect(entryStore.get()[0].synced).toBe(false)
    expect(await syncEntries()).toEqual({ ok: true, value: 1 })
    expect(entryStore.get()[0].synced).toBe(true)
  })

  it("leaves another scout's entries Waiting for them to sign in", async () => {
    const mine = save()
    const theirs = { ...save({ match: 13 }), scouted_by: DEMO_PEOPLE.jordan }
    entryStore.set([theirs, mine])
    expect(await syncEntries()).toEqual({ ok: true, value: 1 })
    expect(entryStore.get().map((e) => [e.match, e.synced])).toEqual([[13, false], [12, true]])
  })
})

describe('entriesToSend', () => {
  const entry = (scouted_by: string | null, synced = false) => ({ scouted_by, synced }) as Entry

  it("picks only the signed-in person's Waiting entries", () => {
    const entries = [entry('me'), entry('me', true), entry('someone else'), entry(null)]
    expect(entriesToSend(entries, 'me')).toEqual([entries[0]])
  })

  it('sends nothing when nobody is signed in', () => {
    expect(entriesToSend([entry(null)], null)).toEqual([])
  })
})

describe('The Blue Alliance in demo mode', () => {
  it('has a schedule of qualification matches, three teams a side', async () => {
    const result = await getSchedule('2026demo')
    if (!result.ok) throw new Error(result.error)
    expect(result.value.length).toBeGreaterThan(0)
    for (const match of result.value) {
      expect(match.key).toBe(`2026demo_qm${match.match_number}`)
      expect(match.alliances.red.team_keys).toHaveLength(3)
      expect(match.alliances.blue.team_keys).toHaveLength(3)
    }
  })

  it('ranks every team once, in order, from the played matches', async () => {
    const result = await getRankings()
    if (!result.ok) throw new Error(result.error)
    expect(result.value.map((r) => r.rank)).toEqual(result.value.map((_, i) => i + 1))
    expect(new Set(result.value.map((r) => r.team_key)).size).toBe(result.value.length)
    expect(result.value[0].record!.wins).toBeGreaterThanOrEqual(result.value[1].record!.wins)
  })

  it("lists only a team's own matches, with videos for played ones", async () => {
    const result = await getTeamMatches(4096)
    if (!result.ok) throw new Error(result.error)
    for (const match of result.value) {
      expect([...match.alliances.red.team_keys, ...match.alliances.blue.team_keys]).toContain('frc4096')
      expect(match.videos.length > 0).toBe(match.alliances.red.score >= 0)
    }
  })

  it('names teams', async () => {
    expect(await getTeam(4096)).toMatchObject({ ok: true, value: { team_number: 4096, nickname: 'Ctrl-Z' } })
    expect(teamNumber('frc4096')).toBe(4096)
  })
})
