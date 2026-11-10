// Checks every migration's file name. You don't need to edit this when you
// add a migration.
//
// Supabase keeps track of which migrations the database has run by the
// number at the start of the name: the date and time, like 20261109120000.
// If two files share a number, one of them never runs, or the Deploy workflow
// fails. The other tests can't tell, because they run every file in name
// order, so this checks the names themselves.
import { describe, expect, it } from 'vitest'

// Every file in supabase/migrations/, not only the ones ending in .sql, so a
// typo in the ending is caught too. (Supabase skips files it doesn't
// recognise, without failing.)
const files = Object.keys(import.meta.glob('../migrations/*'))
  .map((path) => path.split('/').pop()!)
  .sort()

const NAME = /^\d{14}_[a-z0-9_]+\.sql$/

/** A message for each file that isn't named like a migration. */
function badNames(files: string[]): string[] {
  return files
    .filter((file) => !NAME.test(file))
    .map(
      (file) =>
        `${file} isn't named like a migration. Name it with the date and time, then what it does in ` +
        'lower case with _ between words, like 20261101180000_inventory_parts.sql.',
    )
}

/** A message for each number (the digits before the first _) that more than one file uses. */
function sharedNumbers(files: string[]): string[] {
  const byNumber = new Map<string, string[]>()
  for (const file of files) {
    const number = file.split('_')[0]
    byNumber.set(number, [...(byNumber.get(number) ?? []), file])
  }
  return [...byNumber]
    .filter(([, same]) => same.length > 1)
    .map(([number, same]) =>
      same.length === 2
        ? `Two migrations use ${number}: ${same.join(' and ')}. Rename the one that isn't merged yet to a later time.`
        : `${same.length} migrations use ${number}: ${same.join(', ')}. Rename the ones that aren't merged yet to later times, each different.`,
    )
}

describe('every migration', () => {
  it('is named with the date and time, then what it does', () => {
    expect(badNames(files)).toEqual([])
  })

  it('has a number no other migration uses', () => {
    expect(sharedNumbers(files)).toEqual([])
  })
})

// Made-up names, to show the checks above really catch mistakes.
describe('the migration name checks', () => {
  it('find two migrations with the same number', () => {
    expect(
      sharedNumbers([
        '20261109120000_calendar_signups.sql',
        '20261109120000_training_progress.sql',
        '20261110120000_student_leaders.sql',
      ]),
    ).toEqual([
      'Two migrations use 20261109120000: 20261109120000_calendar_signups.sql and ' +
        "20261109120000_training_progress.sql. Rename the one that isn't merged yet to a later time.",
    ])
  })

  it('find three migrations with the same number', () => {
    expect(sharedNumbers(['20261109120000_a.sql', '20261109120000_b.sql', '20261109120000_c.sql'])).toEqual([
      '3 migrations use 20261109120000: 20261109120000_a.sql, 20261109120000_b.sql, 20261109120000_c.sql. ' +
        "Rename the ones that aren't merged yet to later times, each different.",
    ])
  })

  it('find names that are typed wrong', () => {
    const wrong = [
      '2026110912000_too_few_digits.sql',
      '20261109120000-dash_not_underscore.sql',
      '20261109120000_Capital_letters.sql',
      '20261109120000_wrong_ending.SQL',
      '20261109120000_no_ending',
      'calendar_signups.sql',
    ]
    expect(badNames(wrong)).toHaveLength(wrong.length)
    expect(badNames(['20261109120000_calendar_signups.sql'])).toEqual([])
  })
})
